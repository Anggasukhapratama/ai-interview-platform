# frozen_string_literal: true

module Portfolios
  # N10: Generates a structured skill portfolio from the full transcript
  # and final coverage map using Gemini Pro.
  # Runs post-session as a background job.
  class Generator
    def initialize(session:, gemini_client: nil)
      @session = session
      @gemini_client = gemini_client || Gemini::HttpClient.new(
        model:   ENV.fetch('GEMINI_PRO_MODEL', 'gemini-2.0-pro-001'),
        timeout: 180 # up to 3 minutes for large transcripts
      )
    end

    # Returns the Portfolio record with skills populated.
    def call
      portfolio = @session.portfolio || @session.create_portfolio!(
        candidate_id:      @session.candidate_id,
        generation_status: 'pending'
      )

      portfolio.update!(generation_status: 'generating', generation_error: nil)

      candidate_turns = @session.transcript_turns.where(speaker: 'candidate')
      if candidate_turns.none?
        ActiveRecord::Base.transaction do
          portfolio.portfolio_skills.destroy_all
          portfolio.update!(generation_status: 'complete', generated_at: Time.current, generation_error: nil)
        end
        Rails.logger.info("[N10] Session #{@session.id} had 0 candidate turns — completed portfolio with 0 assessed skills")
        return portfolio
      end

      prompt   = build_prompt
      response = @gemini_client.generate_content(prompt, temperature: 0.2)

      save_skills(portfolio, response)
      portfolio.update!(generation_status: 'complete', generated_at: Time.current, generation_error: nil)

      Rails.logger.info("[N10] Portfolio generated for session #{@session.id}")
      portfolio
    rescue StandardError => e
      portfolio&.update(generation_status: 'failed', generation_error: e.message)
      Rails.logger.error("[N10] Portfolio generation failed for session #{@session.id}: #{e.class} #{e.message}")
      raise
    end

    private

    def build_prompt
      assessment        = @session.assessment
      configured_skills = assessment.assessment_skills.order(:display_order)
      coverage_maps     = @session.coverage_maps.order(:id)
      turns             = @session.transcript_turns.ordered

      skills_text = configured_skills.map { |s| skill_definition_block(s) }.join("\n\n")

      coverage_json = {
        skills:     coverage_maps.reject(&:is_discovered).map { |m| coverage_json(m) },
        discovered: coverage_maps.select(&:is_discovered).map { |m| coverage_json(m) }
      }.to_json

      transcript_text = turns.map { |t| "[#{t.speaker.upcase}]: #{t.text}" }.join("\n")

      <<~PROMPT
        You are evaluating a completed skills assessment interview to produce a structured skill portfolio.

        ROLE BEING ASSESSED: #{assessment.name}

        SKILL DEFINITIONS AND BEHAVIORAL ANCHORS:
        #{skills_text}

        UNIVERSAL L1-L5 ANCHORS (use for discovered skills):
        L1 — Executes with explicit guidance and close review. Understands conceptually but cannot apply independently.
        L2 — Executes independently on routine scope. Uses known patterns. Handles common cases but not edge cases.
        L3 — Executes complex, ambiguous scope. Makes tradeoffs. Handles edge cases. Can teach L1-L2.
        L4 — Defines standards and creates reusable systems. Resolves systemic problems. Cross-team impact.
        L5 — Org-level authority. Shapes how the skill is practiced. Rare.

        FINAL COVERAGE MAP:
        #{coverage_json}

        FULL INTERVIEW TRANSCRIPT:
        #{transcript_text}

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        TASK
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

        For EACH skill in the coverage map that was actually discussed in the transcript:
        IMPORTANT: If a configured skill has state = "not_yet" (probe_count = 0) AND there is NO candidate evidence in the transcript for that skill, DO NOT fabricate a level 1 rating — omit it from "configured_skills" or set "level": null so it is accurately recorded as unassessed.

        1. FIND THE EVIDENCE
           Read all transcript turns where this skill was discussed.
           Identify the 2-3 most revealing quotes from the CANDIDATE (not the AI).
           A quote is revealing if it shows HOW they think, not just WHAT they know.

        2. ASSIGN A LEVEL
           Compare the candidate's actual behavior to the L1-L5 anchors.
           Assign the highest level where you see CONSISTENT evidence, not just one strong moment.
           If evidence is mixed (mostly L2 with one L3 moment), assign L2.

        3. WRITE THE COMPETENCY SUMMARY
           2-3 sentences. Focus on patterns, not individual answers.
           What does this person reliably do at this skill? What's the ceiling? What's missing?

        4. ASSIGN CONFIDENCE
           high — probe_count >= 3 AND state = covered
           medium — probe_count = 2 OR state = partial
           low — probe_count <= 1 OR state = initiated

        OUTPUT (JSON only, no prose):
        {
          "configured_skills": [
            {
              "skill_id": "SK-ENG-001",
              "skill_label": "React / Frontend Development",
              "level": 3,
              "confidence": "high",
              "evidence": ["quote 1", "quote 2", "quote 3"],
              "competency_summary": "2-3 sentence summary"
            }
          ],
          "discovered_skills": [
            {
              "skill_label": "Micro-frontend Architecture",
              "level": 2,
              "confidence": "low",
              "evidence": ["quote 1"],
              "competency_summary": "2-3 sentence summary"
            }
          ]
        }
      PROMPT
    end

    def skill_definition_block(skill)
      lines = ['━━━━━━━━━━━━━━━']
      lines << "SKILL: #{skill.skill_label} (#{skill.skill_id || 'custom'})"
      lines << "SCOPE: #{skill.scope_include}" if skill.scope_include.present?
      lines << "WHAT DOES NOT COUNT: #{skill.scope_exclude}" if skill.scope_exclude.present?
      lines << ''
      lines << "L1 — #{skill.l1_anchor}"
      lines << "L2 — #{skill.l2_anchor}"
      lines << "L3 — #{skill.l3_anchor}"
      lines << "L4 — #{skill.l4_anchor}"
      lines << "L5 — #{skill.l5_anchor}"
      lines.join("\n")
    end

    def coverage_json(map)
      {
        id:            map.skill_id || map.skill_label.downcase.gsub(/\s+/, '-'),
        label:         map.skill_label,
        state:         map.state,
        probe_count:   map.probe_count,
        is_discovered: map.is_discovered
      }
    end

    def save_skills(portfolio, response)
      data = response.is_a?(Hash) ? response : JSON.parse(response)
      coverage_maps = @session.coverage_maps.to_a
      configured_skills = @session.assessment.assessment_skills.to_a

      ActiveRecord::Base.transaction do
        # Preserve existing assessor overrides by matching skill_id / skill_label before replacing skills
        existing_overrides = portfolio.portfolio_skills.includes(:assessor_override).each_with_object({}) do |ps, memo|
          next unless ps.assessor_override

          key = (ps.skill_id.presence || ps.skill_label).to_s.downcase.strip
          memo[key] = ps.assessor_override.slice(:override_level, :assessor_notes, :overridden_by, :overridden_at)
        end

        portfolio.portfolio_skills.destroy_all

        Array(data['configured_skills']).each do |skill_data|
          next unless skill_data.is_a?(Hash)

          raw_level = skill_data['level']
          next if raw_level.nil? || raw_level.to_i <= 0

          label    = skill_data['skill_label'].to_s.strip
          skill_id = canonical_skill_id(skill_data['skill_id'], label, configured_skills)
          next if label.blank?

          # Check if the skill was never probed in coverage_maps AND has no evidence quotes
          cov_map = find_coverage_map(coverage_maps, skill_id, label)
          evidence_quotes = Array(skill_data['evidence']).map(&:to_s).map(&:strip).reject(&:blank?).first(3)
          if cov_map && cov_map.state == 'not_yet' && cov_map.probe_count.to_i.zero? && evidence_quotes.empty?
            next
          end

          created = portfolio.portfolio_skills.create!(
            skill_id:           skill_id,
            skill_label:        label,
            is_discovered:      false,
            ai_level:           raw_level.to_i.clamp(1, 5),
            ai_confidence:      normalize_confidence(skill_data['confidence']),
            evidence:           evidence_quotes,
            competency_summary: skill_data['competency_summary'].to_s.strip.presence || 'Evaluated from interview transcript.'
          )

          restore_override_if_present(created, existing_overrides)
        end

        Array(data['discovered_skills']).each do |skill_data|
          next unless skill_data.is_a?(Hash)

          raw_level = skill_data['level']
          next if raw_level.nil? || raw_level.to_i <= 0

          label = skill_data['skill_label'].to_s.strip
          next if label.blank?

          evidence_quotes = Array(skill_data['evidence']).map(&:to_s).map(&:strip).reject(&:blank?).first(3)

          created = portfolio.portfolio_skills.create!(
            skill_id:           nil,
            skill_label:        label,
            is_discovered:      true,
            ai_level:           raw_level.to_i.clamp(1, 5),
            ai_confidence:      normalize_confidence(skill_data['confidence']),
            evidence:           evidence_quotes,
            competency_summary: skill_data['competency_summary'].to_s.strip.presence || 'Discovered during interview.'
          )

          restore_override_if_present(created, existing_overrides)
        end
      end
    end

    def normalize_confidence(raw)
      normalized = raw.to_s.downcase.strip
      PortfolioSkill::CONFIDENCE_LEVELS.include?(normalized) ? normalized : 'low'
    end

    def canonical_skill_id(raw_id, label, configured_skills)
      match = configured_skills.find do |s|
        (raw_id.present? && s.skill_id.present? && s.skill_id.casecmp?(raw_id.to_s)) ||
          s.skill_label.to_s.casecmp?(label.to_s)
      end
      match&.skill_id || raw_id.presence
    end

    def find_coverage_map(coverage_maps, skill_id, label)
      coverage_maps.find do |m|
        (skill_id.present? && m.skill_id.present? && m.skill_id.casecmp?(skill_id.to_s)) ||
          m.skill_label.to_s.casecmp?(label.to_s)
      end
    end

    def restore_override_if_present(portfolio_skill, existing_overrides)
      key = (portfolio_skill.skill_id.presence || portfolio_skill.skill_label).to_s.downcase.strip
      saved = existing_overrides[key]
      return unless saved

      portfolio_skill.create_assessor_override!(
        ai_level:       portfolio_skill.ai_level,
        override_level: saved[:override_level],
        assessor_notes: saved[:assessor_notes],
        overridden_by:  saved[:overridden_by],
        overridden_at:  saved[:overridden_at]
      )
    end
  end
end

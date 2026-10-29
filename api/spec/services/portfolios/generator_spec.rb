# frozen_string_literal: true

require 'rails_helper'

RSpec.describe Portfolios::Generator, type: :service do
  let(:tenant_id) { 101 }

  before do
    Current.tenant_id = tenant_id
  end

  let(:assessment) do
    a = Assessment.create!(
      tenant_id:      tenant_id,
      created_by:     1,
      name:           'Fullstack Assessment',
      language:       'en',
      time_limit_min: 30
    )
    a.assessment_skills.create!(
      skill_id:       'SK-ENG-001',
      skill_label:    'React & TypeScript',
      expected_level: 3,
      display_order:  0,
      l1_anchor:      'L1',
      l2_anchor:      'L2',
      l3_anchor:      'L3',
      l4_anchor:      'L4',
      l5_anchor:      'L5'
    )
    a.assessment_skills.create!(
      skill_id:       'SK-ENG-002',
      skill_label:    'Ruby on Rails',
      expected_level: 3,
      display_order:  1,
      l1_anchor:      'L1',
      l2_anchor:      'L2',
      l3_anchor:      'L3',
      l4_anchor:      'L4',
      l5_anchor:      'L5'
    )
    a
  end

  let(:session_record) do
    Session.create!(
      tenant_id:      tenant_id,
      assessment:     assessment,
      candidate_name: 'Siti Aminah',
      status:         'ended',
      started_at:     10.minutes.ago,
      ended_at:       1.minute.ago
    )
  end

  describe '#call' do
    context 'when candidate disconnects with 0 candidate turns (P0-5)' do
      let(:gemini_client) { instance_double(Gemini::HttpClient) }

      before do
        CoverageMap.create!(
          session:       session_record,
          skill_id:      'SK-ENG-001',
          skill_label:   'React & TypeScript',
          state:         'not_yet',
          probe_count:   0,
          is_discovered: false
        )
        # Only AI greeting turn exists, 0 candidate turns
        TranscriptTurn.create!(
          session:     session_record,
          turn_number: 1,
          speaker:     'ai',
          text:        'Hello Siti, welcome to the interview!'
        )
      end

      it 'marks portfolio complete with 0 fabricated L1 skills without calling Gemini' do
        portfolio = described_class.new(session: session_record, gemini_client: gemini_client).call

        expect(portfolio.generation_status).to eq('complete')
        expect(portfolio.portfolio_skills.count).to eq(0)
      end
    end

    context 'when only 1 of 2 configured skills was probed before time expired (P0-5 & P1-1)' do
      let(:gemini_client) do
        instance_double(
          Gemini::HttpClient,
          generate_content: {
            'configured_skills' => [
              {
                'skill_id'           => 'SK-ENG-001',
                'skill_label'        => 'React & TypeScript',
                'level'              => 3,
                'confidence'         => 'high',
                'evidence'           => ['I use Jotai atoms and React Query to separate server cache from UI state.'],
                'competency_summary' => 'Strong state management architecture.'
              },
              # Suppose Gemini tries to return a fabricated L1 with empty evidence for the unprobed skill:
              {
                'skill_id'           => 'SK-ENG-002',
                'skill_label'        => 'Ruby on Rails',
                'level'              => 1,
                'confidence'         => 'low',
                'evidence'           => [],
                'competency_summary' => 'Not discussed.'
              }
            ],
            'discovered_skills' => []
          }
        )
      end

      before do
        CoverageMap.create!(
          session:       session_record,
          skill_id:      'SK-ENG-001',
          skill_label:   'React & TypeScript',
          state:         'covered',
          probe_count:   3,
          last_signal:   'Explained custom hooks and memoization',
          is_discovered: false
        )
        CoverageMap.create!(
          session:       session_record,
          skill_id:      'SK-ENG-002',
          skill_label:   'Ruby on Rails',
          state:         'not_yet',
          probe_count:   0,
          is_discovered: false
        )
        TranscriptTurn.create!(
          session:     session_record,
          turn_number: 1,
          speaker:     'ai',
          text:        'Tell me about how you manage state in React.'
        )
        TranscriptTurn.create!(
          session:     session_record,
          turn_number: 2,
          speaker:     'candidate',
          text:        'I use Jotai atoms and React Query to separate server cache from UI state.'
        )
      end

      it 'creates PortfolioSkill only for assessed skills and does NOT fabricate L1 for unprobed skills' do
        portfolio = described_class.new(session: session_record, gemini_client: gemini_client).call

        expect(portfolio.generation_status).to eq('complete')
        expect(portfolio.portfolio_skills.count).to eq(1)

        react_skill = portfolio.portfolio_skills.first
        expect(react_skill.skill_id).to eq('SK-ENG-001')
        expect(react_skill.ai_level).to eq(3)
        expect(react_skill.ai_confidence).to eq('high')
      end

      it 'preserves existing assessor overrides when portfolio is regenerated (P1-1)' do
        portfolio = described_class.new(session: session_record, gemini_client: gemini_client).call
        react_skill = portfolio.portfolio_skills.find_by!(skill_id: 'SK-ENG-001')

        AssessorOverride.create!(
          portfolio_skill: react_skill,
          ai_level:        3,
          override_level:  4,
          assessor_notes:  'Verified in live follow-up',
          overridden_by:   42
        )

        # Regenerate portfolio
        regenerated = described_class.new(session: session_record, gemini_client: gemini_client).call
        new_react_skill = regenerated.portfolio_skills.find_by!(skill_id: 'SK-ENG-001')

        expect(new_react_skill.assessor_override).to be_present
        expect(new_react_skill.assessor_override.override_level).to eq(4)
        expect(new_react_skill.assessor_override.assessor_notes).to eq('Verified in live follow-up')
        expect(new_react_skill.effective_level).to eq(4)
      end
    end
  end
end

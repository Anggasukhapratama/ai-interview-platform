# frozen_string_literal: true

require 'rails_helper'

RSpec.describe FitGap::Engine, type: :service do
  let(:tenant_id) { 101 }
  let(:gemini_client) do
    instance_double(
      Gemini::HttpClient,
      generate_content: {
        'culture_narrative' => 'Strong engineering ownership.',
        'overall_narrative' => 'Recommended for technical panel.'
      }
    )
  end

  before do
    Current.tenant_id = tenant_id
  end

  let(:assessment) do
    a = Assessment.create!(
      tenant_id:      tenant_id,
      created_by:     1,
      name:           'Backend Assessment',
      language:       'id',
      time_limit_min: 30
    )
    a.assessment_skills.create!(
      skill_id:       'SK-ENG-003',
      skill_label:    'Desain Sistem',
      expected_level: 4,
      display_order:  0,
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
      candidate_name: 'Budi Santoso',
      status:         'ended',
      started_at:     20.minutes.ago,
      ended_at:       5.minutes.ago
    )
  end

  let(:portfolio) do
    p = Portfolio.create!(
      session:           session_record,
      generation_status: 'complete',
      generated_at:      Time.current
    )

    # Skill 1: Meets expected level via Assessor Override (L4 == L4)
    # Note Indonesian label ('Desain Sistem') vs English vacancy label ('System Design')
    ps1 = PortfolioSkill.create!(
      portfolio:          p,
      skill_id:           'SK-ENG-003',
      skill_label:        'Desain Sistem',
      ai_level:           3,
      ai_confidence:      'high',
      evidence:           ['Designed partitioned Kafka consumers'],
      competency_summary: 'Solid distributed architecture knowledge.'
    )
    AssessorOverride.create!(
      portfolio_skill: ps1,
      ai_level:        3,
      override_level:  4,
      assessor_notes:  'Strong production evidence',
      overridden_by:   1
    )

    # Skill 2: Gap (L2 < L3)
    PortfolioSkill.create!(
      portfolio:          p,
      skill_id:           'SK-ENG-004',
      skill_label:        'Optimasi SQL',
      ai_level:           2,
      ai_confidence:      'medium',
      evidence:           ['Used basic B-Tree indexes'],
      competency_summary: 'Understands basic indexing.'
    )

    p.reload
  end

  let(:vacancy) do
    v = Vacancy.create!(
      tenant_id:               tenant_id,
      created_by:              1,
      role_title:              'Senior Backend Engineer',
      culture_dimensions:      'High ownership',
      competency_expectations: 'Distributed systems'
    )
    v.vacancy_skills.create!(skill_id: 'SK-ENG-003', skill_label: 'System Design & Architecture', expected_level: 4)
    v.vacancy_skills.create!(skill_id: 'SK-ENG-004', skill_label: 'Database Design & SQL',        expected_level: 3)
    v.vacancy_skills.create!(skill_id: 'SK-ENG-007', skill_label: 'DevOps & CI/CD',               expected_level: 3)
    v
  end

  describe '#call' do
    it 'matches skills by canonical skill_id across languages and includes both expected_level and required_level (P0-1 & P1-2)' do
      report = described_class.new(portfolio: portfolio, vacancy: vacancy, gemini_client: gemini_client).call

      expect(report).to be_persisted
      comparisons = report.skill_comparisons
      expect(comparisons.size).to eq(3)

      sys_design_comp = comparisons.find { |c| c['skill_id'] == 'SK-ENG-003' }
      expect(sys_design_comp['result']).to eq('match')
      expect(sys_design_comp['expected_level']).to eq(4)
      expect(sys_design_comp['required_level']).to eq(4)
      expect(sys_design_comp['candidate_level']).to eq(4) # uses assessor override
      expect(sys_design_comp['ai_level']).to eq(3)
      expect(sys_design_comp['is_override']).to be(true)
      expect(sys_design_comp['delta']).to eq(0)

      sql_comp = comparisons.find { |c| c['skill_id'] == 'SK-ENG-004' }
      expect(sql_comp['result']).to eq('gap')
      expect(sql_comp['expected_level']).to eq(3)
      expect(sql_comp['candidate_level']).to eq(2)
      expect(sql_comp['is_override']).to be(false)
      expect(sql_comp['delta']).to eq(-1)

      devops_comp = comparisons.find { |c| c['skill_id'] == 'SK-ENG-007' }
      expect(devops_comp['result']).to eq('not_assessed')
      expect(devops_comp['expected_level']).to eq(3)
      expect(devops_comp['candidate_level']).to be_nil
      expect(devops_comp['delta']).to be_nil
    end

    it 'does not fail validation when a vacancy has 0 skills configured' do
      empty_vacancy = Vacancy.create!(
        tenant_id:  tenant_id,
        created_by: 1,
        role_title: 'Generalist Role'
      )

      report = described_class.new(portfolio: portfolio, vacancy: empty_vacancy, gemini_client: gemini_client).call
      expect(report).to be_persisted
      expect(report.skill_comparisons).to eq([])
      expect(report.overall_narrative).to include('No target skills are configured')
    end
  end
end

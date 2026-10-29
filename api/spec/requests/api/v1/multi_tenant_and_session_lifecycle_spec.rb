# frozen_string_literal: true

require 'rails_helper'

RSpec.describe 'API V1 Multi-Tenant Isolation, Consent & Session Lifecycle', type: :request do
  let!(:org_a) do
    Organization.create!(
      name:       'Tenant A Corp',
      scheme:     'tenant-a',
      identifier: 'tenant-a',
      host:       'tenant-a.local'
    )
  end

  let!(:org_b) do
    Organization.create!(
      name:       'Tenant B Corp',
      scheme:     'tenant-b',
      identifier: 'tenant-b',
      host:       'tenant-b.local'
    )
  end

  let(:headers_a) do
    token = JsonWebToken.encode({ user_id: 10, role: 'admin', scheme: org_a.scheme })
    { 'Authorization' => "Bearer #{token}" }
  end

  let(:headers_b) do
    token = JsonWebToken.encode({ user_id: 20, role: 'admin', scheme: org_b.scheme })
    { 'Authorization' => "Bearer #{token}" }
  end

  let!(:assessment_a) do
    Current.tenant_id = org_a.id
    a = Assessment.create!(
      tenant_id:      org_a.id,
      created_by:     10,
      name:           'Tenant A Assessment',
      language:       'id',
      time_limit_min: 30
    )
    a.assessment_skills.create!(
      skill_id:       'SK-ENG-001',
      skill_label:    'Ruby',
      expected_level: 3,
      display_order:  0,
      l1_anchor:      'L1',
      l2_anchor:      'L2',
      l3_anchor:      'L3',
      l4_anchor:      'L4',
      l5_anchor:      'L5'
    )
    a.assessment_skills.create!(
      skill_id:       'SK-ENG-004',
      skill_label:    'SQL',
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

  let!(:session_a) do
    Current.tenant_id = org_a.id
    Session.create!(
      tenant_id:      org_a.id,
      assessment:     assessment_a,
      candidate_name: 'Andi Wijaya',
      status:         'pending'
    )
  end

  describe 'P0-4: Multi-Tenant IDOR Protection on Portfolios & Overrides' do
    let!(:portfolio_a) do
      Portfolio.create!(
        session:           session_a,
        generation_status: 'complete',
        generated_at:      Time.current
      )
    end

    let!(:portfolio_skill_a) do
      PortfolioSkill.create!(
        portfolio:          portfolio_a,
        skill_id:           'SK-ENG-001',
        skill_label:        'Ruby',
        ai_level:           3,
        ai_confidence:      'high',
        evidence:           ['Good Ruby OOP patterns'],
        competency_summary: 'Solid Ruby skills.'
      )
    end

    it 'blocks Tenant B from reading Tenant A portfolio (returns 404)' do
      get "/api/v1/sessions/#{session_a.id}/portfolio", headers: headers_b
      expect(response).to have_http_status(:not_found)
    end

    it 'blocks Tenant B from overriding Tenant A portfolio skill (returns 404)' do
      post "/api/v1/portfolio_skills/#{portfolio_skill_a.id}/override",
           params:  { override_level: 1, assessor_notes: 'Malicious cross-tenant override' },
           headers: headers_b
      expect(response).to have_http_status(:not_found)
      expect(portfolio_skill_a.reload.assessor_override).to be_nil
    end

    it 'allows Tenant A to read their own portfolio and includes unassessed_skills (P0-5)' do
      CoverageMap.create!(
        session:       session_a,
        skill_id:      'SK-ENG-001',
        skill_label:   'Ruby',
        state:         'covered',
        probe_count:   2,
        is_discovered: false
      )
      CoverageMap.create!(
        session:       session_a,
        skill_id:      'SK-ENG-004',
        skill_label:   'SQL',
        state:         'not_yet',
        probe_count:   0,
        is_discovered: false
      )

      get "/api/v1/sessions/#{session_a.id}/portfolio", headers: headers_a
      expect(response).to have_http_status(:ok)

      body = JSON.parse(response.body)
      expect(body.dig('portfolio', 'skills').size).to eq(1)
      expect(body.dig('portfolio', 'unassessed_skills').size).to eq(1)
      expect(body.dig('portfolio', 'unassessed_skills', 0, 'skill_label')).to eq('SQL')
    end
  end

  describe 'P0-2: Portfolio 202 Accepted for pending and generating states' do
    it 'returns 202 Accepted when portfolio generation_status is pending' do
      Portfolio.create!(session: session_a, generation_status: 'pending')

      get "/api/v1/sessions/#{session_a.id}/portfolio", headers: headers_a
      expect(response).to have_http_status(:accepted)
      body = JSON.parse(response.body)
      expect(body['status']).to eq('generating')
    end

    it 'returns 202 Accepted when portfolio generation_status is generating' do
      Portfolio.create!(session: session_a, generation_status: 'generating')

      get "/api/v1/sessions/#{session_a.id}/portfolio", headers: headers_a
      expect(response).to have_http_status(:accepted)
      body = JSON.parse(response.body)
      expect(body['status']).to eq('generating')
    end
  end

  describe 'P0-3 & P1-5: UU PDP Informed Consent & Candidate Timer Synchronization' do
    it 'records candidate consent with timestamp and exposes started_at in candidate endpoint' do
      post "/api/v1/sessions/#{session_a.invite_token}/consent",
           params: { consent_version: 'uupdp-v1.0-2026' }

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body['consent_given']).to be(true)
      expect(body['consent_version']).to eq('uupdp-v1.0-2026')
      expect(body['consent_given_at']).to be_present

      session_a.update!(status: 'active', started_at: Time.current)

      get "/api/v1/sessions/#{session_a.invite_token}/candidate"
      expect(response).to have_http_status(:ok)
      info = JSON.parse(response.body)
      expect(info['started_at']).to be_present
      expect(info['consent_given']).to be(true)
      expect(info['candidate_name']).to eq('Andi Wijaya')
    end
  end

  describe 'P1-4 & P1-6: Invite URL & Synchronous System Prompt Compilation' do
    it 'generates candidate invite_url pointing to frontend /interview/:invite_token' do
      expect(session_a.invite_url).to end_with("/interview/#{session_a.invite_token}")
    end

    it 'compiles system_prompt synchronously on assessment creation' do
      allow(SystemPromptGeneratorWorker).to receive(:perform_async)

      post '/api/v1/assessments',
           params:  {
             assessment: {
               name:                         'New Sync Prompt Assessment',
               language:                     'id',
               time_limit_min:               30,
               assessment_skills_attributes: [
                 {
                   skill_id:       'SK-ENG-001',
                   skill_label:    'React / Frontend Development Core',
                   expected_level: 3,
                   display_order:  0,
                   l1_anchor:      'L1',
                   l2_anchor:      'L2',
                   l3_anchor:      'L3',
                   l4_anchor:      'L4',
                   l5_anchor:      'L5'
                 }
               ]
             }
           },
           headers: headers_a

      expect(response).to have_http_status(:created)
      created_id = JSON.parse(response.body).dig('assessment', 'id')
      expect(Assessment.unscoped.find(created_id).system_prompt).to be_present
    end
  end
end

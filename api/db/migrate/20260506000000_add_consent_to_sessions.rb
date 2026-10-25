# frozen_string_literal: true

class AddConsentToSessions < ActiveRecord::Migration[7.0]
  def change
    add_column :sessions, :consent_given_at, :datetime, null: true
    add_column :sessions, :consent_version, :string, limit: 50, null: true
  end
end

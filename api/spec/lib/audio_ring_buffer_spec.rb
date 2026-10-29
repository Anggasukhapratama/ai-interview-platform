# frozen_string_literal: true

require 'rails_helper'

RSpec.describe AudioRingBuffer do
  # 1 second capacity = 32,000 bytes
  subject(:buffer) { described_class.new(capacity_seconds: 1) }

  describe '#write / #push, #empty?, and #drain (AI Verification Moment)' do
    it 'supports write alias, empty? check, and drain for Gemini reconnect replay' do
      expect(buffer.empty?).to be(true)

      buffer.write('chunk-1')
      buffer.write('chunk-2')

      expect(buffer.empty?).to be(false)
      expect(buffer.count).to eq(2)
      expect(buffer.size).to eq(14)

      drained = buffer.drain
      expect(drained).to eq('chunk-1chunk-2')
      expect(buffer.empty?).to be(true)
      expect(buffer.size).to eq(0)
    end

    it 'evicts oldest chunks when capacity_bytes is exceeded' do
      chunk_a = 'A' * 20_000
      chunk_b = 'B' * 20_000

      buffer.push(chunk_a, timestamp: 1000)
      buffer.push(chunk_b, timestamp: 2000)

      expect(buffer.count).to eq(1)
      expect(buffer.drain).to eq(chunk_b)
    end

    it 'ignores nil or empty chunks safely' do
      buffer.write(nil)
      buffer.write('')
      expect(buffer.empty?).to be(true)
    end
  end
end

# Laporan Studi Kasus: Fullstack Product Engineer — Revamp AI Interview Platform

**Deliverable Kandidat — Tahap 1 s/d Tahap 6 (Steps 1–6)**  
**Branch Utama:** `feat/product-revamp`  
**Branch Bukti Seeded Fault:** `test/seeded-fault-proof`

---

## 1. Ringkasan Eksekutif & Pemahaman Konteks Mendalam / Domain Immersion (Step 2)

### 1.1 Gambaran Produk, Tujuan & Arsitektur Sistem
**AI Interview Platform** adalah sistem asesmen talenta B2B *multi-tenant* yang dibangun menggunakan **Ruby on Rails 7 API (`api/`)** dan **React 18 + TypeScript + Vite SPA (`web/`)**. Berbeda dengan kuis pilihan ganda statis atau rekaman video satu arah (*one-way video interview*), platform ini menyelenggarakan wawancara teknis dan perilaku (*behavioral*) secara *live*, adaptif, dan dua arah berbasis suara (*voice-to-voice*) menggunakan **Google Gemini Live (`BidiGenerateContent`)** melalui jembatan WebSocket *full-duplex* (`AudioWebSocketMiddleware`).

Selama wawancara berlangsung, *background worker* pendamping (`CoverageAnalyzerWorker` + `Coverage::Analyzer`) mengevaluasi setiap giliran bicara kandidat (*transcript turns*) untuk melacak kedalaman penggalian kompetensi berdasarkan **Taksonomi Kompetensi B7** (`not_yet` -> `initiated` -> `partial` -> `covered`), lalu menyuntikkan instruksi pembaruan secara dinamis (`Coverage::MapInjector`) ke dalam sesi AI yang sedang berjalan. Setelah sesi berakhir, `Portfolios::Generator` menyusun **Portofolio Kompetensi (Skill Portfolio)** terstruktur (level `L1–L5`, tingkat keyakinan/*confidence*, dan kutipan bukti transkrip), yang dapat ditinjau oleh Asesor, dikoreksi secara manual (`AssessorOverride`), diekspor ke PDF (`Exports::PdfGenerator`), serta dibandingkan terhadap kebutuhan lowongan kerja melalui **Fit/Gap Engine** (`FitGap::Engine`).

### 1.2 Konteks Industri HRTech Indonesia, Pengguna (Asesor) & Kandidat (UU PDP No. 27/2022)
Di pasar rekrutmen korporasi Indonesia (perbankan, BUMN, *tech unicorn*, dan perusahaan jasa teknologi), tim HR/Asesor harus menyaring ratusan hingga ribuan pelamar per lowongan dengan kondisi infrastruktur jaringan kandidat yang beragam (mulai dari Wi-Fi kantor dengan *firewall* ketat hingga *tethering* seluler 4G). Terdapat **3 prinsip utama** yang menentukan kesiapan produksi (*production readiness*):

1. **Integritas Bukti Penilaian bagi Asesor (*Evidence Integrity over Hallucinated Ratings*):** Asesor harus dapat mempercayai bahwa nilai `L1` berarti *"kandidat terbukti menunjukkan perilaku level L1 berdasarkan kutipan jawaban"*—bukan *"kandidat terputus di awal atau waktu habis sebelum AI sempat menanyakan skill tersebut."* Selain itu, koreksi manual asesor (`AssessorOverride`) tidak boleh hilang saat portofolio di-*regenerate*, dan pencocokan *Fit/Gap* harus bekerja akurat meskipun bahasa *Assessment* (Indonesia) berbeda dengan bahasa *Vacancy* (Inggris).
2. **Keadilan bagi Kandidat & Kepatuhan UU PDP (UU No. 27 Tahun 2022):** Perekaman suara biometrik, akses kamera *proctoring*, dan pemrofilan kompetensi otomatis oleh AI termasuk pemrosesan data pribadi spesifik/umum yang wajib didahului oleh **persetujuan eksplisit yang diinformasikan (*informed consent*)** serta tercatat waktu persetujuannya di database sesuai **Pasal 20–22 UU Pelindungan Data Pribadi (UU No. 27/2022)**.
3. **Isolasi Keamanan Multi-Tenant B2B yang Ketat:** Dalam produk SaaS B2B, kebocoran data portofolio atau manipulasi nilai lintas perusahaan (*cross-tenant IDOR*) adalah kegagalan keamanan fatal (P0).

---

## 2. Analisis Masalah & Celah Sistem / Problem & Gap Analysis (Step 3)

### 2.1 Klasifikasi Temuan (P0–P3): Defective Implementation vs. Missing Specification

| ID | Prioritas | Judul Temuan Masalah | Klasifikasi | Lapisan / Seam | Akar Masalah & Dampak ke Pengguna |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **P0-1** | **P0** | **Ketidakcocokan Kontrak `expected_level` vs `required_level` pada Fit/Gap** | **Defective Implementation** | Seam `api/` <-> `web/` (`FitGap::Engine` -> `ComparisonTable.tsx`) | Backend mengirimkan key JSON `expected_level`, sedangkan tabel di frontend membaca `c.required_level`, sehingga seluruh kolom *Required* menampilkan tulisan **`Lundefined`** dan menyembunyikan status *Assessor Override*. |
| **P0-2** | **P0** | **Deadlock Polling Portofolio pada Status `pending` (`422` / `200` vs `202`)** | **Defective Implementation** | Seam `api/` <-> `web/` (`PortfoliosController#show` -> `PortfolioPage.tsx`) | Saat sesi berakhir, `Portfolio` dibuat dengan status `pending` sembari menunggu antrean Sidekiq. Namun `PortfoliosController#show` hanya mengembalikan `202 Accepted` untuk status `generating?`, sehingga saat status masih `pending` frontend berhenti melakukan *polling* dan halaman macet. |
| **P0-3** | **P0** | **Absennya Gerbang Persetujuan Privasi & Audit Trail UU PDP No. 27/2022** | **Missing Specification** | Fullstack (Tabel `sessions`, `SessionsController`, `InterviewPage.tsx`) | Kandidat langsung diminta menyalakan kamera/mikrofon dan direkam AI tanpa pemberitahuan privasi, kotak centang persetujuan eksplisit, maupun pencatatan waktu persetujuan (`consent_given_at`, `consent_version`) di database. |
| **P0-4** | **P0** | **Celah Keamanan Multi-Tenant IDOR pada Portofolio & Override Nilai** | **Defective Implementation** | Keamanan `api/` (`PortfoliosController`, `PortfolioSkillsController`) | Query `Portfolio.find_by(session_id: ...)` dan `PortfolioSkill.find(...)` tidak memfilter `sessions: { tenant_id: current_tenant_id }`, sehingga Asesor dari Tenant B dapat membaca portofolio atau mengubah nilai kandidat milik Tenant A. |
| **P0-5** | **P0** | **Pembuatan Nilai `L1` Palsu untuk Skill yang Belum Ditanyakan / Sesi 0 Turn** | **Missing Specification & Defective Implementation** | `api/` <-> `web/` (`Portfolios::Generator`, `PortfoliosController`, `PortfolioPage.tsx`) | Ketika wawancara berakhir lebih awal atau waktu habis sebelum semua skill ditanyakan (`state == 'not_yet'`, `probe_count == 0`), sistem mengizinkan pembuatan nilai `L1` palsu alih-alih memisahkannya sebagai `unassessed_skills` (*Not Evaluated*). |
| **P0-6** | **P0** | **`LoadError: cannot load such file -- ostruct` pada Autentikasi di Ruby 4.0** | **Defective Implementation** | `api/` (`AuthorizeApiRequest`) | `AuthorizeApiRequest` memanggil `require 'ostruct'`, padahal `ostruct` telah dihapus dari *default gems* sejak Ruby 4.0, menyebabkan seluruh endpoint terautentikasi gagal diakses jika tidak diganti dengan `Struct` bawaan Ruby. |
| **P1-1** | **P1** | **Hilangnya `AssessorOverride` saat Portofolio Di-regenerate** | **Defective Implementation** | `api/` (`Portfolios::Generator#save_skills`) | Pemanggilan `portfolio.portfolio_skills.destroy_all` berjalan di luar transaksi database dan ikut menghapus seluruh catatan koreksi manual asesor (`dependent: :destroy`). |
| **P1-2** | **P1** | **Kegagalan Pencocokan Fit/Gap Lintas Bahasa (Indonesia vs Inggris)** | **Defective Implementation** | `api/` (`FitGap::Engine#find_portfolio_skill`) | Mencocokkan skill hanya berdasarkan kesamaan teks `skill_label` tanpa mengecek kode kanonik `skill_id` terlebih dahulu, sehingga *"Desain Sistem"* (`SK-ENG-003`) gagal cocok dengan *"System Design"* (`SK-ENG-003`). |
| **P1-3** | **P1** | **Korupsi Frame Audio Biner & Race Condition Timer Reconnect WebSocket** | **Defective Implementation** | `api/` (`AudioWebSocketMiddleware`, `AudioRingBuffer`, `EndHandler`) | Frame audio PCM biner (`Array<Integer>`) sempat melewati `JSON.parse`; saat kandidat *refresh* browser, timer 120 detik dari socket lama tidak dibatalkan; serta `AudioRingBuffer` belum memiliki method `write`, `empty?`, dan `drain`. |
| **P1-4** | **P1** | **Link Undangan Kandidat (`invite_url`) Mengarah ke Port Backend (`3001`)** | **Defective Implementation** | `api/` (`Session#invite_url`) | Menggunakan `BACKEND_BASE_URL` (`http://localhost:3001/interview/:token`) alih-alih `FRONTEND_BASE_URL` (`http://localhost:5173/interview/:token`), menghasilkan error 404 saat dibuka kandidat. |
| **P1-5** | **P1** | **Timer Wawancara Kandidat Ter-reset ke Awal Saat Refresh Browser** | **Defective Implementation** | `api/` <-> `web/` (`SessionsController#candidate_info`, `InterviewTimer.tsx`) | `InterviewTimer` hanya menghitung mundur dari `timeLimitMin * 60` di state React lokal tanpa mengacu pada timestamp `started_at` dari server. |
| **P1-6** | **P1** | **Race Condition `system_prompt` Async & Gagal Hapus Tanpa Pesan Error** | **Defective Implementation** | `api/` (`AssessmentsController`, `VacanciesController`) | Memulai sesi tepat setelah membuat Assessment berisiko mendapati `system_prompt` masih `nil`; aksi `destroy` mengabaikan nilai balik `false` dari `restrict_with_error` dan tetap mengembalikan `200 OK`. |
| **P2-1** | **P2** | **Blokir Firewall pada Tes Kecepatan Cloudflare & Header CSP Kamera** | **Defective Implementation** | `web/` (`internetSpeedTest.ts`, `vercel.json`) | Gagal total jika `speed.cloudflare.com` diblokir jaringan kantor; `vercel.json` memblokir kamera (`camera=()`) dan belum mengizinkan domain Cloudflare di CSP. |
| **P2-2** | **P2** | **Crash Export PDF Prawn pada Karakter Unicode (`->`, `---`, Kutip Lengkung)** | **Defective Implementation** | `api/` (`Exports::PdfGenerator`) | Font bawaan Helvetica di Prawn menggunakan `WinAnsiEncoding` dan *crash* (`IncompatibleStringEncoding`) saat transkrip atau ringkasan AI memuat simbol panah atau *em-dash*. |
| **P3-1** | **P3** | **Validasi Form Skill Kosong/Duplikat & Pemotongan Transkrip LiveMonitor** | **Defective Implementation** | `web/` (`AssessmentEditPage.tsx`, `VacancyEditPage.tsx`, `LiveMonitorPage.tsx`) | Mengizinkan penyimpanan 0 skill atau skill ganda; `LiveMonitorPage` memotong transkrip hanya 10 baris terakhir (`.slice(-10)`) dan tidak memiliki *fallback polling* HTTP saat WebSocket terputus. |

### 2.2 Analisis Sinyal Batasan (*Constraint Signal Analysis*)
- **Masuk Cakupan Pengerjaan (*In-Scope — Wajib Diperbaiki Sekarang*):** Isolasi multi-tenant (`P0-4`), kontrak data `api/` <-> `web/` (`P0-1`, `P0-2`, `P0-5`), persetujuan UU PDP (`P0-3`), pelestarian override asesor (`P1-1`), pencocokan `skill_id` kanonik (`P1-2`), ketahanan WebSocket audio & reconnect (`P1-3`), serta sinkronisasi timer server (`P1-5`).
- **Diluar Cakupan Saat Ini (*Scoped Out — Roadmap Berikutnya*):** Migrasi penuh PostgreSQL Row-Level Security (RLS) pada tabel warisan `rakamin-api`, penyediaan klaster server *WebRTC TURN relay* khusus, dan penyematan file font TTF CJK eksternal untuk Prawn PDF.

---

## 3. Strategi Revamp, Kriteria Penerimaan & Trade-off Solusi (Step 4)

### 3.1 Kriteria Penerimaan Mandiri (*Self-Defined Acceptance Criteria* AC-1 s/d AC-8)
- **AC-1 (Kontrak Fit/Gap & Pencocokan Kanonik):** `FitGap::Engine` mengirimkan `expected_level` sekaligus `required_level`, `ai_level`, dan `is_override`. `ComparisonTable.tsx` menampilkan level `L1–L5` dan badge `Override` tanpa `Lundefined`. Pencocokan memprioritaskan `skill_id` (case-insensitive) sebelum `skill_label`.
- **AC-2 (Nol Nilai `L1` Palsu untuk Skill yang Belum Diuji):** Sesi dengan 0 jawaban kandidat menghasilkan 0 baris `PortfolioSkill`. Skill dengan `state == 'not_yet'`, `probe_count == 0`, dan tanpa kutipan bukti dikeluarkan dari `portfolio_skills` dan dikembalikan dalam `unassessed_skills`, ditampilkan pada bagian khusus **"Unassessed Skills (Not Evaluated)"** di `PortfolioPage.tsx`.
- **AC-3 (Polling Portofolio Tangguh & Regenerasi Atomik):** `GET /api/v1/sessions/:id/portfolio` mengembalikan `202 Accepted` (`{ status: 'generating' }`) saat `@portfolio.nil? || @portfolio.in_progress?` (`pending` maupun `generating`). Regenerasi portofolio berjalan di dalam `ActiveRecord::Base.transaction` dan memulihkan `AssessorOverride` yang sudah ada.
- **AC-4 (Persetujuan Eksplisit UU PDP No. 27/2022):** Kandidat wajib menyetujui pemberitahuan privasi & perekaman suara AI dwibahasa (ID/EN) di `InterviewPage.tsx` sebelum pemeriksaan kamera/mikrofon dimulai, menyimpan `consent_given_at` dan `consent_version` melalui `POST /api/v1/sessions/:token/consent`.
- **AC-5 (Pencegahan IDOR Multi-Tenant):** `PortfoliosController` dan `PortfolioSkillsController` memfilter seluruh query melalui `Session` dengan `sessions: { tenant_id: current_tenant_id }`. Akses lintas tenant otomatis mengembalikan `404 Not Found`.
- **AC-6 (Ketahanan Reconnect WebSocket & Timer Berbasis Server):** Registri `ACTIVE_CONNECTIONS` membatalkan `graceful_end_timer` 120 detik milik koneksi lama saat kandidat *reconnect*; `AudioRingBuffer` mendukung `write`, `empty?`, dan `drain` untuk memutar ulang audio ke Gemini; `InterviewTimer.tsx` menghitung sisa waktu dari `started_at` server.
- **AC-7 (Kompilasi Prompt Sinkron & Invalidasi Cache):** `AssessmentsController#create` dan `#update` mengompilasi `system_prompt` secara sinkron menggunakan `Prompts::SystemPromptCompiler`. `VacanciesController#update` menghapus cache `FitGapReport` lama saat daftar skill lowongan berubah.
- **AC-8 (Fallback Jaringan Korporat & Keamanan Encoding PDF):** `internetSpeedTest.ts` beralih ke pengukuran latensi API internal jika `speed.cloudflare.com` diblokir *firewall*; `Exports::PdfGenerator` menormalkan karakter Unicode non-WinAnsi sebelum dirender oleh Prawn.

### 3.2 Analisis Trade-off Arsitektur (Opsi A vs. Opsi B)
1. **Representasi Skill yang Belum Diuji (*Unassessed Skills*):**
   - *Opsi A:* Mengubah kolom `ai_level` di tabel `portfolio_skills` menjadi *nullable* dan menyimpan skill yang belum ditanyakan dengan `ai_level: nil` (mengharuskan penghapusan constraint `NOT NULL` dan `CHECK (ai_level >= 1 AND ai_level <= 5)` di PostgreSQL).
   - *Opsi B (Dipilih):* Menjaga tabel `portfolio_skills` tetap murni untuk skill yang benar-benar ternilai (`1..5`) dan menghitung `unassessed_skills` secara dinamis di `PortfoliosController` dari selisih `session.coverage_maps.configured` terhadap `portfolio.portfolio_skills`. Pendekatan ini menjaga integritas constraint database dan mencegah distorsi perhitungan rata-rata skor.
2. **Normalisasi Kontrak JSON Fit/Gap:**
   - *Opsi A:* Hanya mengubah `ComparisonTable.tsx` agar membaca `expected_level`.
   - *Opsi B (Dipilih — Normalisasi Dua Kunci):* Mengirimkan `expected_level` sekaligus `required_level` dari `FitGap::Engine`, menormalkan data JSONB lama di `PortfoliosController#fit_gap_json`, serta memperbarui `ComparisonTable.tsx` untuk membaca `c.required_level ?? c.expected_level`. Ini menjamin kompatibilitas mundur (*backward compatibility*) 100% terhadap laporan Fit/Gap yang sudah tersimpan di database.

---

## 4. Implementasi Monozukuri, Pengujian Otomatis & Bukti Verifikasi (Step 5)

### 4.1 Hasil Eksekusi Suite Pengujian Otomatis (100% Lulus)
- **Backend (`api/` — RSpec):** `16 examples, 0 failures` (`bundle exec rspec --format documentation`)
  - `spec/lib/audio_ring_buffer_spec.rb` (3 skenario pengujian)
  - `spec/services/fit_gap/engine_spec.rb` (2 skenario pengujian)
  - `spec/services/portfolios/generator_spec.rb` (3 skenario pengujian)
  - `spec/requests/api/v1/multi_tenant_and_session_lifecycle_spec.rb` (8 skenario pengujian)
- **Frontend (`web/` — TypeScript + Vite Build & Node Test Runner):**
  - `npm run build` (`tsc && vite build`): **0 error**, bundle produksi berhasil dikompilasi (`1841 modules transformed`).
  - `npm test` (`node --test tests/frontend_contracts.test.mjs`): **4 tes lulus, 0 gagal**.

### 4.2 AI Verification Moment (Verifikasi Kritis terhadap Kode Hasil Bantuan AI)
Selama pengerjaan Step 5, terdapat dua momen verifikasi kritis di mana pemeriksaan langsung terhadap kode sumber dan runtime mencegah bug tersembunyi di produksi:

1. **Verifikasi Antarmuka & Tipe Nilai Balik `AudioRingBuffer`:**
   - Saat menghubungkan `AudioWebSocketMiddleware#replay_buffered_audio` (`state.audio_ring_buffer.drain`) dan `#handle_browser_audio` (`state.audio_ring_buffer.write(pcm_data)`), kode awal mengasumsikan `AudioRingBuffer` telah memiliki method `.write`, `.empty?`, dan `.drain` yang mengembalikan `Array<String>`.
   - Setelah memeriksa `api/app/lib/audio_ring_buffer.rb` dan `Gemini::LiveClient#send_audio` secara langsung, kami menemukan bahwa:
     1. `AudioRingBuffer` awalnya hanya mendefinisikan `#push(pcm_bytes, timestamp:)`, `#since`, `#size`, `#count`, dan `#clear`—sehingga pemanggilan `.write`, `.empty?`, atau `.drain` akan memicu `NoMethodError` saat koneksi Gemini mengalami *reconnect*!
     2. `state.gemini_client.send_audio(buffered)` membutuhkan **satu `String` biner gabungan** (`@chunks.map(&:data).join`), bukan `Array` potongan audio. Kami menambahkan implementasi yang tepat pada `AudioRingBuffer` dan memverifikasinya melalui `spec/lib/audio_ring_buffer_spec.rb`.
2. **Penanganan Penghapusan `ostruct` di Ruby 4.0 yang Tertangkap oleh RSpec:**
   - Saat menjalankan *request spec* RSpec pada lingkungan Ruby 4.0.7, pengujian langsung menangkap `LoadError: cannot load such file -- ostruct` pada `app/auth/authorize_api_request.rb:3` karena `ostruct` telah dihapus dari *default gems* di Ruby 4.0. Mengganti `OpenStruct.new` dengan `Struct` bawaan Ruby (`UserPrincipal = Struct.new(:id, :role, :scheme, keyword_init: true)`) menghilangkan ketergantungan gem eksternal dan memulihkan seluruh endpoint autentikasi.

### 4.3 Bukti Pengujian Kesalahan Buatan (*Seeded Fault Test Proof*)
Untuk membuktikan bahwa pengujian otomatis kami benar-benar menguji logika bisnis dan bukan sekadar tes formalitas:
1. Pada branch `test/seeded-fault-proof`, kami sengaja menyuntikkan kesalahan (*seeded fault*) pada `FitGap::Engine#find_portfolio_skill` (mengabaikan pencocokan `skill_id` kanonik dan hanya mencocokkan teks `skill_label`).
2. Menjalankan `bundle exec rspec spec/services/fit_gap/engine_spec.rb` langsung menggagalkan tes dengan pesan tegas:
   `Failure/Error: expect(sys_design_comp['result']).to eq('match') — expected: "match", got: "not_assessed"`.
3. Kesalahan buatan tersebut di-*commit* pada `724d4ff` dan kemudian dibatalkan (*revert*) melalui `git revert HEAD` pada commit `eefc5ac` di branch `test/seeded-fault-proof` sehingga riwayat Git merekam bukti nyata pengujian tersebut.

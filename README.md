# Multi Live Chat

Dashboard gabungan chat TikTok LIVE dan YouTube LIVE

# Untuk
Multi live chat berfungsi untuk melihat chat saat streaming atau live di platform tiktok maupun youtube

## Jalankan di komputer

1. Install Node.js versi LTS.
2. Ekstrak folder ini.
3. Buka terminal di folder `multilive-chat`.
4. Jalankan `npm install`.
5. Salin `.env.example` menjadi `.env`.
6. (Opsional untuk YouTube) Isi `YOUTUBE_API_KEY` di `.env`.
7. Jalankan `npm start`.
8. Buka `http://localhost:3000` di browser.

## YouTube API key

- Buat project di Google Cloud Console.
- Aktifkan **YouTube Data API v3**.
- Buat API key, lalu masukkan ke `.env`.
- Masukkan `@handle` atau Channel ID channel YouTube di dashboard.

YouTube API memiliki kuota dan pembatasan. API key disimpan di server, jangan dimasukkan ke HTML.

## TikTok

Masukkan username akun yang sedang LIVE (boleh dengan atau tanpa @).
Konektor `tiktok-live-connector` adalah library tidak resmi yang bergantung pada layanan internal TikTok. Perubahan TikTok dapat membuat koneksi gagal sewaktu-waktu. Jangan masukkan password atau cookie akun TikTok.

## Catatan

- Dashboard ini perlu backend Node.js aktif; membuka `index.html` langsung tidak cukup.
- Jika akun offline, statusnya akan menjadi OFFLINE dan chat tidak muncul.
- Proyek ini menerima pesan dan gift event TikTok serta pesan teks YouTube.
- Untuk overlay di OBS, akses alamat server dari perangkat yang sama atau jaringan lokal.
- 

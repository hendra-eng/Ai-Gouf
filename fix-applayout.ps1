# Jalankan dari root folder Dashboard
# PASTIKAN sudah backup (git commit / copy folder) sebelum menjalankan ini

$files = Get-ChildItem -Recurse -Filter "page.tsx" | Where-Object {
    $_.FullName -notmatch "\\src\\app\\page\.tsx$" -and
    $_.FullName -notmatch "\\financial-statements\\page\.tsx$"
}

foreach ($f in $files) {
    $content = Get-Content $f.FullName -Raw
    $original = $content

    # Hapus baris import AppLayout
    $content = $content -replace "(?m)^\s*import AppLayout from ['""]@/components/AppLayout['""];\s*\r?\n", ""

    # Hapus tag pembuka <AppLayout ...>
    $content = $content -replace "<AppLayout[^>]*>\s*\r?\n?", ""

    # Hapus tag penutup </AppLayout>
    $content = $content -replace "\s*</AppLayout>", ""

    if ($content -ne $original) {
        Set-Content -Path $f.FullName -Value $content -NoNewline
        Write-Host "FIXED : $($f.FullName)" -ForegroundColor Green
    } else {
        Write-Host "SKIP (tidak ada perubahan, cek manual) : $($f.FullName)" -ForegroundColor Yellow
    }
}

Write-Host "`nSelesai. Cek satu-satu hasilnya, lalu restart dev server (npm run dev)." -ForegroundColor Cyan
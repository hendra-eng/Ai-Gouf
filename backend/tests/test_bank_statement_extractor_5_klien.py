"""
tests/test_bank_statement_extractor_5_klien.py
==============================================
Regresi ekstraksi Bank Feed (modules/transactions/bank_statement_extractor.py +
bank_statement_recipes.py) atas dataset template Bank Cash 5 klien di
dataset/Bank Cash/{AADL,BIRAWA,NBM,NPI,UBD} (Juni-Agustus 2026):

  * rekening koran BCA/BRI/Mandiri/OCBC (PDF & CSV) -- jalur grid/words/table;
  * Permata Transaction History (tanda '-' terpisah di depan nominal), Permata
    Transaction Inquiry (resep permata_inquiry), Permata ME Saver (resep permata_me,
    arah dari warna, tanpa saldo -> 'unverified' memang wajar);
  * buku kas Excel AADL (1 sheet per bulan digabung, DEBET = uang masuk -> arah ditukar
    otomatis, baris tanpa tanggal mewarisi tanggal) & laporan belanja Petty Cash NPI
    (resep petty_expense, sheet bulan terakhir).

Angka acuan = hasil ekstraksi yang sudah dicek terhadap saldo berjalan / ringkasan resmi
dokumen (status 'verified' = semua baris cocok saldo / total resmi).

Template & mapping hasil analisis ini: migrations/bank_cash/seed_template_<klien>_multi_format_bank_cash.sql.
test_template_seed_cocok memastikan signature di seed = signature ekstraksi dan
template seed memberi label bank yang benar. File dataset tidak ikut repo di semua mesin -> skip.
"""

import json
import re
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

import pytest

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from modules.transactions import bank_statement_extractor as bx  # noqa: E402

DATASET = Path(__file__).resolve().parents[2] / "dataset" / "Bank Cash"
SEED = Path(__file__).resolve().parent.parent / "migrations" / "bank_cash"

KASUS = [
    # file, metode, signature, status, baris, no rekening, saldo awal, saldo akhir, total debit, total kredit, periode awal, periode akhir
    ('AADL/AGUSTUS/2026 Kas d_Kappu Soemantri Coffee 24 - 31 Agustus ‘26.xlsx', 'table', '91525298a4fd1ad190fbbb454738c38a990af05c30ff3cb8e5099dc9f4f2df69', 'verified', 527, None, '791500.00', '714110.00', '49024700.00', '48947310.00', '2026-01-01', '2026-08-31'),
    ('AADL/AGUSTUS/260903_113756_report_07027771771_transactionhistory.pdf', 'words', 'c6378a0c147556b6ef9ce4aabd85bd625da48011a850a42c18eeb845f47a7b5f', 'verified', 20, '07027771771', '146294385.00', '223901428.00', '22411175.00', '100018218.00', '2026-08-01', '2026-08-31'),
    ('AADL/AGUSTUS/5265275785_AUG_2026.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 20, '5265275785', '2920942.67', '4404730.67', '16000.00', '1499788.00', '2026-08-01', '2026-08-31'),
    ('AADL/AGUSTUS/ESTATEMENT_05855600177_202608.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 29, '5855600177', '39917072.00', '49782122.00', '8534950.00', '18400000.00', '2026-08-01', '2026-08-31'),
    ('AADL/AGUSTUS/ESTATEMENT_05855710177_202608.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 55, '5855710177', '151625968.94', '179248917.64', '16652153.00', '44275101.70', '2026-08-01', '2026-08-31'),
    ('AADL/AGUSTUS/ESTATEMENT_05855779177_202608.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 39, '5855779177', '4819319.00', '6061234.00', '30570769.00', '31812684.00', '2026-08-01', '2026-08-31'),
    ('AADL/AGUSTUS/ESTATEMENT_05855820177_202608.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 31, '5855820177', '33598789.00', '53081199.00', '6717590.00', '26200000.00', '2026-08-01', '2026-08-31'),
    ('AADL/AGUSTUS/IBIZ_040901001771307_20260801_20260831_1788410131841153200.pdf', 'words', 'a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457', 'verified', 186, '040901001771307', '18717713.80', '55013459.80', '94523551.00', '130819297.00', '2026-08-01', '2026-08-31'),
    ('AADL/AGUSTUS/IBIZ_040901017700302_20260801_20260831_1788410142216896997.pdf', 'words', 'a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457', 'verified', 36, '040901017700302', '642546.60', '7244073.60', '3534000.00', '10135527.00', '2026-08-01', '2026-08-31'),
    ('AADL/AGUSTUS/Rekap Pembayaran Patty cash Omah Soemantri - 2026.xlsx', 'table', '9de012a76cbe55cd901339577493617628c05d5189328a2485dabf943a2ac26a', 'verified', 1582, None, '2290693.00', '3325753.00', '364858931.00', '365893991.00', '2025-12-01', '2026-08-31'),
    ('AADL/AGUSTUS/Rekapan Pembayaran Patty Cash Putu Soemantri 2026.xlsx', 'table', '908825ef9fb4d264e56d4b10df0df56da41fc731a71d9f05c7ede62634749168', 'verified', 630, None, '138368.00', '2787856.00', '127100512.00', '129750000.00', '2025-12-01', '2026-09-30'),
    ('AADL/AGUSTUS/Rekapan Pembayaran Pattycash Kost Kapu Soemantri 2026.xlsx', 'table', '908825ef9fb4d264e56d4b10df0df56da41fc731a71d9f05c7ede62634749168', 'verified', 109, None, '807335.00', '1043102.00', '27601953.00', '27837720.00', '2025-12-01', '2026-08-31'),
    ('AADL/AGUSTUS/Rekapan Pembayaran Pattycash Kost Warung Soemantri 2026.xlsx', 'table', '908825ef9fb4d264e56d4b10df0df56da41fc731a71d9f05c7ede62634749168', 'verified', 136, None, '629537.00', '1096620.00', '24526567.00', '24993650.00', '2025-12-01', '2026-08-31'),
    ('AADL/AGUSTUS/Rekapan Pembayaran Pattycash Warung Soemantri 2026.xlsx', 'table', '908825ef9fb4d264e56d4b10df0df56da41fc731a71d9f05c7ede62634749168', 'verified', 210, None, '1100561.00', '1556040.00', '89554800.00', '90010279.00', '2025-12-01', '2026-08-31'),
    ('AADL/AGUSTUS/Transaction History - Permata ME Saver1325 - 3182026114133.pdf', 'recipe', 'f2211c3669d8bfeb1bf69e83060e3585009f9f40039dea10bfc47a0a1770337b', 'unverified', 10, '009929951325', None, None, '6438203.00', '6444298.00', '2026-08-01', '2026-08-31'),
    ('AADL/JULI/2026 Kas d_Kappu Soemantri Coffee  Juli sd awal Agustus _26.xlsx', 'table', '91525298a4fd1ad190fbbb454738c38a990af05c30ff3cb8e5099dc9f4f2df69', 'verified', 466, None, '791500.00', '1835710.00', '44181200.00', '45225410.00', '2026-01-01', '2026-08-31'),
    ('AADL/JULI/260803_145724_report_07027771771_transactionhistory.pdf', 'words', 'c6378a0c147556b6ef9ce4aabd85bd625da48011a850a42c18eeb845f47a7b5f', 'verified', 22, '07027771771', '56962183.00', '146294385.00', '915906057.00', '1005238259.00', '2026-07-01', '2026-07-31'),
    ('AADL/JULI/5265275785_JUL_2026.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 30, '5265275785', '11522065.67', '2920942.67', '11103623.00', '2502500.00', '2026-07-01', '2026-07-31'),
    ('AADL/JULI/ESTATEMENT_05855600177_202607.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 21, '5855600177', '29047022.00', '39917072.00', '4729950.00', '15600000.00', '2026-07-01', '2026-07-31'),
    ('AADL/JULI/ESTATEMENT_05855710177_202607.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 80, '5855710177', '336218236.69', '151625968.94', '231056026.00', '46463758.25', '2026-07-01', '2026-07-31'),
    ('AADL/JULI/ESTATEMENT_05855779177_202607.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 45, '5855779177', '4348814.00', '4819319.00', '37868337.00', '38338842.00', '2026-07-01', '2026-07-31'),
    ('AADL/JULI/ESTATEMENT_05855820177_202607.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 29, '5855820177', '15426379.00', '33598789.00', '5627590.00', '23800000.00', '2026-07-01', '2026-07-31'),
    ('AADL/JULI/IBIZ_040901001771307_20260701_20260731_1785743917385813073.pdf', 'words', 'a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457', 'verified', 174, '040901001771307', '39122146.80', '18717713.80', '124893866.00', '104489433.00', '2026-07-01', '2026-07-31'),
    ('AADL/JULI/IBIZ_040901017700302_20260701_20260731_1785743927795900723.pdf', 'words', 'a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457', 'verified', 45, '040901017700302', None, '642546.60', '12090029.00', '10421671.00', '2026-07-01', '2026-07-31'),
    ('AADL/JULI/Rekap Pembayaran Patty cash Omah Soemantri - 2026 (2).xlsx', 'table', '9de012a76cbe55cd901339577493617628c05d5189328a2485dabf943a2ac26a', 'verified', 1424, None, '2290693.00', '977184.00', '327709087.00', '326395578.00', '2025-12-01', '2026-07-31'),
    ('AADL/JULI/Rekapan Pembayaran Patty Cash Putu Soemantri 2026 (2).xlsx', 'table', '908825ef9fb4d264e56d4b10df0df56da41fc731a71d9f05c7ede62634749168', 'verified', 561, None, '138368.00', '3062711.00', '112725657.00', '115650000.00', '2025-12-01', '2026-08-31'),
    ('AADL/JULI/Rekapan Pembayaran Pattycash Kost Kapu Soemantri 2026 (2).xlsx', 'table', '908825ef9fb4d264e56d4b10df0df56da41fc731a71d9f05c7ede62634749168', 'verified', 97, None, '807335.00', '882847.00', '24427118.00', '24502630.00', '2025-12-01', '2026-07-31'),
    ('AADL/JULI/Rekapan Pembayaran Pattycash Kost Warung Soemantri 2026 (2).xlsx', 'table', '908825ef9fb4d264e56d4b10df0df56da41fc731a71d9f05c7ede62634749168', 'verified', 120, None, '629537.00', '549281.00', '21743956.00', '21663700.00', '2025-12-01', '2026-07-31'),
    ('AADL/JULI/Rekapan Pembayaran Pattycash Warung Soemantri 2026 (2).xlsx', 'table', '908825ef9fb4d264e56d4b10df0df56da41fc731a71d9f05c7ede62634749168', 'verified', 182, None, '1100561.00', '3014316.00', '80346524.00', '82260279.00', '2025-12-01', '2026-07-31'),
    ('AADL/JUNI/2026 Kas d_Kappu Soemantri Coffee  29 Juni - 5 Juli 2026.xlsx', 'table', '91525298a4fd1ad190fbbb454738c38a990af05c30ff3cb8e5099dc9f4f2df69', 'verified', 407, None, '791500.00', '2023510.00', '40463200.00', '41695210.00', '2026-01-01', '2026-07-31'),
    ('AADL/JUNI/260706_094650_report_07027771771_transactionhistory.pdf', 'words', 'c6378a0c147556b6ef9ce4aabd85bd625da48011a850a42c18eeb845f47a7b5f', 'verified', 28, '07027771771', '3677375.00', '56962183.00', '56717920.00', '110002728.00', '2026-06-01', '2026-06-30'),
    ('AADL/JUNI/5265275785_JUN_2026.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 47, '5265275785', '38780806.57', '11522065.67', '28389259.53', '1130518.63', '2026-06-01', '2026-06-30'),
    ('AADL/JUNI/ESTATEMENT_05855600177_202606.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 25, '5855600177', '10976972.00', '29047022.00', '4729950.00', '22800000.00', '2026-06-01', '2026-06-30'),
    ('AADL/JUNI/ESTATEMENT_05855710177_202606.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 44, '5855710177', '280720120.74', '336218236.69', '30000.00', '55528115.95', '2026-06-01', '2026-06-30'),
    ('AADL/JUNI/ESTATEMENT_05855779177_202606.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 28, '5855779177', '3420746.00', '4348814.00', '28581098.00', '29509166.00', '2026-06-01', '2026-06-30'),
    ('AADL/JUNI/ESTATEMENT_05855820177_202606.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 32, '5855820177', '2123969.00', '15426379.00', '11697590.00', '25000000.00', '2026-06-01', '2026-06-30'),
    ('AADL/JUNI/IBIZ_040901001771307_20260601_20260630_1783302453132246614.pdf', 'words', 'a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457', 'verified', 182, '040901001771307', '14709449.80', '39122146.80', '117184231.00', '141596928.00', '2026-06-01', '2026-06-30'),
    ('AADL/JUNI/IBIZ_040901017700302_20260601_20260630_1783302463630986108.pdf', 'words', 'a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457', 'verified', 51, '040901017700302', '5885122.60', '2310904.60', '18103000.00', '14528782.00', '2026-06-01', '2026-06-30'),
    ('AADL/JUNI/Rekap Pembayaran Patty cash Omah Soemantri - 2026.xlsx', 'table', '9de012a76cbe55cd901339577493617628c05d5189328a2485dabf943a2ac26a', 'verified', 1262, None, '2290693.00', '4569395.00', '285187126.00', '287465828.00', '2025-12-01', '2026-07-31'),
    ('AADL/JUNI/Rekapan Pembayaran Patty Cash Putu Soemantri 2026.xlsx', 'table', '908825ef9fb4d264e56d4b10df0df56da41fc731a71d9f05c7ede62634749168', 'verified', 506, None, '138368.00', '-865369.00', '102653737.00', '101650000.00', '2025-12-01', '2026-07-31'),
    ('AADL/JUNI/Rekapan Pembayaran Pattycash Kost Kapu Soemantri 2026.xlsx', 'table', '908825ef9fb4d264e56d4b10df0df56da41fc731a71d9f05c7ede62634749168', 'verified', 88, None, '807335.00', '1047975.00', '22056900.00', '22297540.00', '2025-12-01', '2026-06-30'),
    ('AADL/JUNI/Rekapan Pembayaran Pattycash Kost Warung Soemantri 2026.xlsx', 'table', '908825ef9fb4d264e56d4b10df0df56da41fc731a71d9f05c7ede62634749168', 'verified', 109, None, '629537.00', '1144107.00', '19819180.00', '20333750.00', '2025-12-01', '2026-06-30'),
    ('AADL/JUNI/Rekapan Pembayaran Pattycash Warung Soemantri 2026.xlsx', 'table', '908825ef9fb4d264e56d4b10df0df56da41fc731a71d9f05c7ede62634749168', 'verified', 163, None, '1100561.00', '3724356.00', '72636484.00', '75260279.00', '2025-12-01', '2026-07-31'),
    ('BIRAWA/RK Birawa Jun_26.pdf', 'recipe', 'a517568e7ccbae93387bacf6479a287ccbbe816058f29afcd759b3c63799fc1d', 'verified', 66, '00702328993', '1818205910.00', '1761142784.00', '8319160708.00', '8262097582.00', '2026-06-01', '2026-06-30'),
    ('BIRAWA/RK Permata - Birawa2608.pdf', 'recipe', 'a517568e7ccbae93387bacf6479a287ccbbe816058f29afcd759b3c63799fc1d', 'verified', 68, '00702328993', '1434359722.00', '1003071197.00', '10160486379.00', '9729197854.00', '2026-08-01', '2026-08-31'),
    ('BIRAWA/RK Permata Jul_26 - Birawa.pdf', 'recipe', 'a517568e7ccbae93387bacf6479a287ccbbe816058f29afcd759b3c63799fc1d', 'verified', 72, '00702328993', '1761142784.00', '1434359722.00', '8980114473.00', '8653331411.00', '2026-07-01', '2026-07-31'),
    ('NBM/5325107836_AUG_2026.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 44, '5325107836', '37210252.60', '67605122.13', '26127888.13', '56522757.66', '2026-08-01', '2026-08-31'),
    ('NBM/5325107836_JUL_2026.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 36, '5325107836', '59299617.95', '37210252.60', '57010126.41', '34920761.06', '2026-07-01', '2026-07-31'),
    ('NBM/5325107836_JUN_2026.pdf', 'words', '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0', 'verified', 34, '5325107836', '50536392.99', '59299617.95', '40010175.99', '48773400.95', '2026-06-01', '2026-06-30'),
    ('NBM/NBM_BCA 1350838208_202606.csv', 'table', 'f5ae1a529acbe10941098a4b0fefab521a2d1a806ecf14f1f02d660fa798bfc9', 'verified', 344, '1350838208', '19233714.86', '18907777.71', '318567713.55', '318241776.40', '2026-06-01', '2026-06-30'),
    ('NBM/NBM_BCA 1350838208_202607.csv', 'table', 'f5ae1a529acbe10941098a4b0fefab521a2d1a806ecf14f1f02d660fa798bfc9', 'verified', 389, '1350838208', '18907777.71', '9937071.76', '369309933.35', '360339227.40', '2026-07-01', '2026-07-31'),
    ('NBM/NBM_BCA 1350838208_202608.csv', 'table', 'f5ae1a529acbe10941098a4b0fefab521a2d1a806ecf14f1f02d660fa798bfc9', 'verified', 375, '1350838208', '9937071.76', '15800170.32', '398723051.44', '404586150.00', '2026-08-01', '2026-08-31'),
    ('NBM/NBM_BRI_059001001757302_202606.pdf', 'words', 'a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457', 'verified', 82, '059001001757302', None, '12058188.00', '25769232.00', '29112921.00', '2026-06-01', '2026-06-30'),
    ('NBM/NBM_BRI_059001001757302_202607.csv', 'table', 'dd357869ce244a4d0db4986bf71dfe6bcfe176cb030de8d26679c8536a9fcfbf', 'verified', 86, '59001001757302', '12058188.00', '21327737.00', '23535600.00', '32805149.00', '2026-07-01', '2026-07-31'),
    ('NBM/NBM_BRI_059001001757302_202608.csv', 'table', 'dd357869ce244a4d0db4986bf71dfe6bcfe176cb030de8d26679c8536a9fcfbf', 'verified', 85, '59001001757302', '21327737.00', '13270935.00', '41032500.00', '32975698.00', '2026-08-01', '2026-08-31'),
    ('NBM/NBM__BRI_059001001642303_202606.pdf', 'words', 'a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457', 'verified', 80, '059001001642303', '44315363.60', '40371281.60', '131272114.00', '127328032.00', '2026-06-01', '2026-06-30'),
    ('NBM/NBM__BRI_059001001642303_202607.csv', 'table', 'dd357869ce244a4d0db4986bf71dfe6bcfe176cb030de8d26679c8536a9fcfbf', 'verified', 100, '59001001642303', '40371281.60', '63834752.60', '140579585.00', '164043056.00', '2026-07-01', '2026-07-31'),
    ('NBM/NBM__BRI_059001001642303_202608.csv', 'table', 'dd357869ce244a4d0db4986bf71dfe6bcfe176cb030de8d26679c8536a9fcfbf', 'verified', 103, '59001001642303', '63834752.60', '58801680.60', '169318044.00', '164284972.00', '2026-08-01', '2026-08-31'),
    ('NPI/AGUSTUS/NPI_MANDIRI DELI_1450018412482_202608.pdf', 'words', 'ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31', 'verified', 115, '1450018412482', '1866867.26', '6017286.95', '50040467.92', '54190887.61', '2026-08-01', '2026-08-31'),
    ('NPI/AGUSTUS/NPI_MANDIRI_1450017315108_202608.pdf', 'words', 'ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31', 'verified', 136, '1450017315108', '482756.83', '2637698.64', '64638318.45', '66793260.26', '2026-08-01', '2026-08-31'),
    ('NPI/AGUSTUS/NPI_MANDIRI_1750003319273_202608.pdf', 'words', 'ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31', 'verified', 561, '1750003319273', '2421537.23', '549268.54', '797305614.85', '795433346.16', '2026-08-01', '2026-08-31'),
    ('NPI/AGUSTUS/NPI_OCBC_IDR_163800007094_202608.pdf', 'grid', '5fe193b3cdd3feb30bbeb79af4e0ad803ad8f33104f78a411dad9e272ed557f4', 'verified', 6, '163800007094', '110977.00', '125957.00', '15385079.00', '15400059.00', '2026-08-01', '2026-08-31'),
    ('NPI/JULI/NPI_MANDIRI DELI_1450018412482_202607.pdf', 'words', 'ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31', 'verified', 117, '1450018412482', '7704987.33', '1866867.26', '44949656.00', '39111535.93', '2026-07-01', '2026-07-31'),
    ('NPI/JULI/NPI_MANDIRI_1450017315108_202607.pdf', 'words', 'ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31', 'verified', 119, '1450017315108', '4336526.01', '482756.83', '51742459.00', '47888689.82', '2026-07-01', '2026-07-31'),
    ('NPI/JULI/NPI_MANDIRI_1750003319273_202607.pdf', 'words', 'ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31', 'verified', 595, '1750003319273', '51408327.55', '2421537.23', '750382496.54', '701395706.22', '2026-07-01', '2026-07-31'),
    ('NPI/JULI/NPI_OCBC_IDR_163800007094_202607.pdf', 'grid', '5fe193b3cdd3feb30bbeb79af4e0ad803ad8f33104f78a411dad9e272ed557f4', 'verified', 33, '163800007094', '728335.00', '110977.00', '108430607.00', '107813249.00', '2026-07-01', '2026-07-31'),
    ('NPI/JUNI/NPI_MANDIRI DELI_1450018412482_202606.pdf', 'words', 'ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31', 'verified', 103, '1450018412482', '13415086.29', '7704987.33', '38394759.76', '32684660.80', '2026-06-01', '2026-06-30'),
    ('NPI/JUNI/NPI_MANDIRI_1450017315108_202606.pdf', 'words', 'ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31', 'verified', 95, '1450017315108', '11724383.62', '4336526.01', '50943563.10', '43555705.49', '2026-06-01', '2026-06-30'),
    ('NPI/JUNI/NPI_MANDIRI_1750003319273_202606.pdf', 'words', 'ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31', 'verified', 431, '1750003319273', '42894694.93', '51408327.55', '458401907.91', '466915540.53', '2026-06-01', '2026-06-30'),
    ('NPI/JUNI/NPI_OCBC_IDR_163800007094_202606.pdf', 'grid', '5fe193b3cdd3feb30bbeb79af4e0ad803ad8f33104f78a411dad9e272ed557f4', 'verified', 60, '163800007094', '23065.00', '728335.00', '312921257.00', '313626527.00', '2026-06-01', '2026-06-30'),
    ('NPI/NPI_Petty_Cash_202609.xlsx', 'recipe', '8dc36f77d7b6664d81177328136ec0f00cef4d50578c0344c60497324fd3e95b', 'verified', 310, None, '0.00', '0.00', '38195000.00', '38195000.00', '2026-09-01', '2026-09-30'),
    ('UBD/UBD_OCBC CWU_165810049909_202606.pdf', 'grid', 'f001b1ee249e969a1a7150bbb1ea7ffe6623963339b12cb869c6985cb8fc549d', 'verified', 162, '165810049909', '17429313.65', '11871827.02', '1660153486.63', '1654596000.00', '2026-06-01', '2026-06-30'),
    ('UBD/UBD_OCBC CWU_165810049909_202607.pdf', 'grid', 'f001b1ee249e969a1a7150bbb1ea7ffe6623963339b12cb869c6985cb8fc549d', 'verified', 145, '165810049909', '11871827.02', '80906825.03', '235407049.81', '304442047.82', '2026-07-01', '2026-07-31'),
    ('UBD/UBD_OCBC_IDR_165800001092_202606.pdf', 'grid', 'f001b1ee249e969a1a7150bbb1ea7ffe6623963339b12cb869c6985cb8fc549d', 'verified', 40, '165800001092', '1583634384.38', '1196776010.38', '852463956.00', '465605582.00', '2026-06-01', '2026-06-30'),
    ('UBD/UBD_OCBC_IDR_165800001092_202607.pdf', 'grid', 'f001b1ee249e969a1a7150bbb1ea7ffe6623963339b12cb869c6985cb8fc549d', 'verified', 42, '165800001092', '1196776010.38', '1373471069.56', '466989699.82', '643684759.00', '2026-07-01', '2026-07-31'),
    ('UBD/UBD_OCBC_IDR_165800001092_202608_unlocked.pdf', 'grid', 'f001b1ee249e969a1a7150bbb1ea7ffe6623963339b12cb869c6985cb8fc549d', 'verified', 28, '165800001092', '1373471069.56', '1684016955.92', '224317196.64', '534863083.00', '2026-08-01', '2026-08-31'),
]


def _baca(rel):
    path = DATASET / rel
    if not path.exists():
        pytest.skip(f"dataset tidak ada: {path}")
    return path.read_bytes(), path.name


@pytest.mark.parametrize("rel,metode,signature,status,jumlah,no_rek,awal,akhir,debit,kredit,mulai,selesai", KASUS)
def test_ekstraksi_5_klien(rel, metode, signature, status, jumlah, no_rek, awal, akhir, debit, kredit, mulai, selesai):
    isi, nama = _baca(rel)
    h = bx.ekstrak_rekening_koran(isi, nama)
    assert h is not None
    v = h.validasi
    assert h.metode == metode
    assert h.signature == signature
    assert v["status"] == status
    assert len(h.baris) == jumlah
    assert h.no_rekening == no_rek
    if status == "verified":
        assert v["rows_low"] == 0 and v["balance_mismatches"] == 0
    for nilai, acuan in ((v["opening_balance"], awal), (v["closing_balance"], akhir)):
        assert (nilai is None and acuan is None) or Decimal(f"{nilai:.2f}") == Decimal(acuan)
    assert Decimal(f"{v['total_debit']:.2f}") == Decimal(debit)
    assert Decimal(f"{v['total_credit']:.2f}") == Decimal(kredit)
    assert (h.periode[0].isoformat() if h.periode[0] else None) == mulai
    assert (h.periode[1].isoformat() if h.periode[1] else None) == selesai


def _template_seed():
    """{klien: [template dict seperti _template_dict]} dari blok $tpl$ seed."""
    hasil = {}
    for p in SEED.glob("seed_template_*_multi_format_bank_cash.sql"):
        m = re.search(r"\$tpl\$(.*?)\$tpl\$", p.read_text(encoding="utf-8"), re.S)
        if not m:
            continue
        klien = p.name.split("_")[2].upper()
        hasil[klien] = [{"id": t["key"], "template_name": t["name"], "file_type": t["file_type"],
                         "column_signature_hash": t["signature"], "mapping_rules": t["mapping_rules"]}
                        for t in json.loads(m.group(1))]
    return hasil


def test_template_seed_cocok():
    seed = _template_seed()
    assert set(seed) >= {"AADL", "BIRAWA", "NBM", "NPI", "UBD"}
    dipakai = defaultdict(set)
    for rel, metode, signature, status, jumlah, *_ in KASUS:
        klien = rel.split("/")[0]
        path = DATASET / rel
        if not path.exists():
            continue
        h = bx.ekstrak_rekening_koran(path.read_bytes(), path.name, seed[klien])
        assert h.template is not None, f"{rel}: tidak ada template seed yang cocok"
        assert h.signature == signature and h.validasi["status"] == status and len(h.baris) == jumlah, rel
        assert h.bank == h.template["mapping_rules"]["bank_name"], rel
        dipakai[klien].add(h.template["id"])
    for klien, tpls in seed.items():
        if dipakai.get(klien):
            assert {t["id"] for t in tpls} == dipakai[klien], f"{klien}: ada template seed tanpa file contoh"


def test_permata_history_bank_dari_template():
    """Permata Transaction History tidak mencetak nama bank di kepala dokumen; isi transaksi menyebut
    BANK MANDIRI / BANK CENTRAL ASIA -> label harus datang dari template seed, bukan dari isi transaksi."""
    isi, nama = _baca("AADL/JUNI/260706_094650_report_07027771771_transactionhistory.pdf")
    h = bx.ekstrak_rekening_koran(isi, nama, _template_seed()["AADL"])
    assert h.bank == "Permata"


def test_bri_ibbiz_bukan_mandiri():
    """BRI IBBIZ: nama bank hanya di halaman terakhir; transaksi menyebut bank lain."""
    isi, nama = _baca("AADL/JULI/IBIZ_040901001771307_20260701_20260731_1785743917385813073.pdf")
    assert bx.ekstrak_rekening_koran(isi, nama).bank == "BRI"


def test_pdf_terkunci_password():
    path = DATASET / "UBD" / "UBD_OCBC CWU_165810049909_202608.pdf"
    if not path.exists():
        pytest.skip("dataset tidak ada")
    with pytest.raises(bx.EkstraksiGagal) as e:
        bx.ekstrak_rekening_koran(path.read_bytes(), path.name)
    assert e.value.kode == "PDF_LOCKED"

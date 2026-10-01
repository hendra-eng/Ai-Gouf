"""
modules/asset/fixed_assets_v1.py
==================================
Fixed Asset Register & Depreciation di halaman Assets, sumber tabel
asset_fixed_assets (schema 4_Assets_Equity). Lihat
db_client.py::ambil_fixed_assets() utk detail perhitungan penyusutan.

Dipindah APA ADANYA dari main.py (path, auth, response model TIDAK
diubah) -- lihat modules/asset/__init__.py untuk catatan lengkap kenapa
pemindahan ini menghapus registrasi lama di main.py (bukan menambah
path baru seperti pola modules/management/).

Tidak menggantikan KPI/grafik total Assets (useAssetsData.ts) yang
tetap dari saldo neraca/COA.
"""

from __future__ import annotations

from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db_client as dbc
from ..auth import core as auth
from ..logging_config import get_module_logger

logger = get_module_logger("asset_fixed_assets_v1")

router = APIRouter(prefix="/api/v1/asset", tags=["assets"])


# ============================================================
# SKEMA
# ============================================================

class FixedAssetRowSkema(BaseModel):
    """Satu baris register aset tetap, SUDAH dihitung penyusutannya --
    lihat db_client.py::ambil_fixed_assets()."""
    id: str
    name: str
    category: Optional[str] = None
    purchaseDate: Optional[str] = None
    cost: float = 0
    residualValue: float = 0
    usefulLifeYears: Optional[int] = None
    method: Optional[str] = None
    accumulatedDepreciation: float = 0
    netBookValue: float = 0
    monthlyDepreciation: float = 0
    status: Optional[str] = None
    physicalStatus: Optional[str] = None
    location: Optional[str] = None
    department: Optional[str] = None
    needsReview: bool = False


class DataFixedAssetsResponse(BaseModel):
    assets: List[FixedAssetRowSkema]
    ada_data: bool


class TambahFixedAssetSkema(BaseModel):
    """Hasil tambah aset -- bentuk ringkas (id/kode/nama saja), BUKAN
    FixedAssetRowSkema penuh -- lihat tambah_fixed_asset()."""
    id: str
    asset_code: Optional[str] = None
    name: str


class TambahFixedAssetResponse(BaseModel):
    berhasil: bool
    asset: TambahFixedAssetSkema


class UbahFixedAssetSkema(BaseModel):
    """Hasil ubah aset -- bentuk ringkas, lihat ubah_fixed_asset()."""
    id: str
    asset_code: Optional[str] = None
    name: str


class UbahFixedAssetResponse(BaseModel):
    berhasil: bool
    asset: UbahFixedAssetSkema


class DisposisiFixedAssetSkema(BaseModel):
    """Hasil disposisi aset -- bentuk ringkas, lihat disposisi_fixed_asset()."""
    id: str
    asset_code: Optional[str] = None
    status: str


class DisposisiFixedAssetResponse(BaseModel):
    berhasil: bool
    asset: DisposisiFixedAssetSkema


class TambahFixedAssetRequest(BaseModel):
    """Body POST /api/v1/asset/addFixedAsset (tombol "Add Asset")."""
    name: str
    category: Optional[str] = None
    purchase_date: Optional[str] = None  # YYYY-MM-DD
    cost: Decimal = Decimal("0")
    residual_value: Decimal = Decimal("0")
    useful_life_years: Optional[int] = None
    depreciation_method: Optional[str] = None
    location: Optional[str] = None
    department: Optional[str] = None


class UbahFixedAssetRequest(BaseModel):
    """Body PATCH /api/v1/asset/updateFixedAsset (tombol "Edit").
    Semua field opsional -- hanya yang dikirim (bukan None) yang diubah."""
    name: Optional[str] = None
    category: Optional[str] = None
    purchase_date: Optional[str] = None
    cost: Optional[Decimal] = None
    residual_value: Optional[Decimal] = None
    useful_life_years: Optional[int] = None
    depreciation_method: Optional[str] = None
    location: Optional[str] = None
    department: Optional[str] = None
    needs_review: Optional[bool] = None
    status: Optional[str] = None  # active/maintenance/inactive (bukan 'disposed' -- pakai endpoint /dispose)


class DisposisiFixedAssetRequest(BaseModel):
    """Body PATCH /api/v1/asset/disposeFixedAsset."""
    disposal_date: str  # YYYY-MM-DD
    disposal_value: Decimal = Decimal("0")


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/getFixedAssets", response_model=DataFixedAssetsResponse)
def api_fixed_assets(client_id: str, user: dict = Depends(auth.get_current_user)):
    """Register aset tetap per-unit -- sumber Fixed Asset Register &
    Depreciation Section di assetRegisterBridge.ts (menggantikan sumber
    lama hasil upload file 'Aset Tetap' di public.hasil)."""
    return dbc.ambil_fixed_assets(client_id)


@router.post("/addFixedAsset", response_model=TambahFixedAssetResponse)
def api_tambah_fixed_asset(
    client_id: str, req: TambahFixedAssetRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Tambah aset tetap baru."""
    try:
        hasil = dbc.tambah_fixed_asset(
            client_id=client_id, name=req.name, category=req.category, purchase_date=req.purchase_date,
            cost=req.cost, residual_value=req.residual_value, useful_life_years=req.useful_life_years,
            depreciation_method=req.depreciation_method, location=req.location, department=req.department,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="tambah_fixed_asset",
        detail={"name": req.name, "cost": float(req.cost)},
    )
    return {"berhasil": True, "asset": hasil}


@router.patch("/updateFixedAsset", response_model=UbahFixedAssetResponse)
def api_ubah_fixed_asset(
    client_id: str, asset_id: str, req: UbahFixedAssetRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Ubah field aset tetap yang ada."""
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    try:
        hasil = dbc.ubah_fixed_asset(client_id=client_id, asset_id=asset_id, **fields)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="ubah_fixed_asset",
        detail={"asset_id": asset_id, "fields": list(fields.keys())},
    )
    return {"berhasil": True, "asset": hasil}


@router.patch("/disposeFixedAsset", response_model=DisposisiFixedAssetResponse)
def api_disposisi_fixed_asset(
    client_id: str, asset_id: str, req: DisposisiFixedAssetRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Tandai aset sebagai disposed (dijual/dibuang) -- permanen."""
    try:
        hasil = dbc.disposisi_fixed_asset(
            client_id=client_id, asset_id=asset_id,
            disposal_date=req.disposal_date, disposal_value=req.disposal_value,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="disposisi_fixed_asset",
        detail={"asset_id": asset_id, "disposal_date": req.disposal_date, "disposal_value": float(req.disposal_value)},
    )
    return {"berhasil": True, "asset": hasil}
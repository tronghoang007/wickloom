"""Dữ liệu của người dùng đăng nhập: watchlist, layouts, drawings. Chủ sở hữu lấy từ session (client không gửi user_id).
Lưu vào đúng 3 bảng cũ với id = "<user_id>:<id client>", scope = user_id; route cắt tiền tố khi trả về. User khác
không bao giờ chạm tới hàng này vì khoá luôn được dựng từ user_id của session (id lạ -> 404, không lộ là có tồn tại)."""
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from . import state
from .auth import current_user

router = APIRouter(prefix="/me")

WATCHLIST_ID = "default"
PREFS_ID = "default"


def _key(user: Dict[str, Any], id: str) -> str:
    return f"{user['id']}:{id}"


def _doc(user: Dict[str, Any], row: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": row["id"][len(user["id"]) + 1:], "data": row["data"]}


@router.get("/watchlist")
def get_watchlist(user: Dict[str, Any] = Depends(current_user)):
    row = state.meta.get("watchlists", _key(user, WATCHLIST_ID))
    if not row:
        raise HTTPException(404)
    return _doc(user, row)


@router.put("/watchlist")
def put_watchlist(body: Dict[str, Any], user: Dict[str, Any] = Depends(current_user)):
    state.meta.put("watchlists", _key(user, WATCHLIST_ID), user["id"], body)
    return {"ok": True}


@router.get("/prefs")
def get_prefs(user: Dict[str, Any] = Depends(current_user)):
    """Tuỳ chọn của tài khoản dùng chung mọi layout / thiết bị (mặc định công cụ vẽ...): 1 document JSON, web tự định nghĩa nội dung."""
    row = state.meta.get("prefs", _key(user, PREFS_ID))
    if not row:
        raise HTTPException(404)
    return _doc(user, row)


@router.put("/prefs")
def put_prefs(body: Dict[str, Any], user: Dict[str, Any] = Depends(current_user)):
    state.meta.put("prefs", _key(user, PREFS_ID), user["id"], body)
    return {"ok": True}


def _collection(table: str) -> APIRouter:
    r = APIRouter(prefix=f"/{table}")

    @r.get("")
    def list_(user: Dict[str, Any] = Depends(current_user)):
        return [_doc(user, row) for row in state.meta.list(table, user["id"])]

    @r.get("/{id}")
    def get_(id: str, user: Dict[str, Any] = Depends(current_user)):
        row = state.meta.get(table, _key(user, id))
        if not row:
            raise HTTPException(404)
        return _doc(user, row)

    @r.put("/{id}")
    def put_(id: str, body: Dict[str, Any], user: Dict[str, Any] = Depends(current_user)):
        state.meta.put(table, _key(user, id), user["id"], body)
        return {"ok": True}

    @r.delete("/{id}")
    def delete_(id: str, user: Dict[str, Any] = Depends(current_user)):
        state.meta.delete(table, _key(user, id))
        return {"ok": True}

    return r


router.include_router(_collection("layouts"))
router.include_router(_collection("drawings"))

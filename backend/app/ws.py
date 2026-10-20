import asyncio
from typing import Any, Dict, Optional, Set, Tuple

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        self.clients: Dict[WebSocket, Set[Tuple[str, str]]] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Call once from async context (lifespan startup) to capture the running loop."""
        self._loop = loop

    def subscribed_symbols(self) -> Set[str]:
        return {s for subs in self.clients.values() for s, _ in subs}

    def subscribed_pairs(self) -> Set[Tuple[str, str]]:
        return {p for subs in self.clients.values() for p in subs}

    def publish(self, symbol: str, tf: str, msg: Dict[str, Any]) -> None:
        """Gửi tới client đã subscribe (symbol, tf); tf rỗng = mọi TF của symbol."""
        for ws, subs in list(self.clients.items()):
            if (symbol, tf) in subs or (not tf and any(s == symbol for s, _ in subs)):
                if self._loop is not None and self._loop.is_running():
                    asyncio.run_coroutine_threadsafe(self._send(ws, msg), self._loop)
                else:
                    # Already on the event loop thread
                    asyncio.ensure_future(self._send(ws, msg))

    def broadcast(self, msg: Dict[str, Any]) -> None:
        """Gửi tới mọi client (vd "reset" khi đổi broker/server)."""
        for ws in list(self.clients):
            if self._loop is not None and self._loop.is_running():
                asyncio.run_coroutine_threadsafe(self._send(ws, msg), self._loop)
            else:
                asyncio.ensure_future(self._send(ws, msg))

    async def _send(self, ws: WebSocket, msg: Dict[str, Any]) -> None:
        try:
            await ws.send_json(msg)
        except Exception:
            self.clients.pop(ws, None)

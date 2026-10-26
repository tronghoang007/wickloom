import { create } from "zustand";

/** Hộp thoại xác nhận dùng chung (gọi được từ ngoài React, vd các hành động giao dịch): `askConfirm` mở, <ConfirmHost /> vẽ. Một hộp một lúc. */
export type ConfirmRow = { label: string; value: string; tone?: "buy" | "sell" | "pos" | "neg" };
export type ConfirmRequest = {
  title: string;
  message?: string;
  rows?: ConfirmRow[]; // bảng tóm tắt đối tượng bị tác động
  confirmLabel: string;
  cancelLabel?: string; // mặc định "Huỷ"; vd "Giữ lệnh" khi hỏi có huỷ lệnh không
  danger?: boolean;
  onCancel?: () => unknown; // Huỷ / X / Esc / bấm nền (không chạy khi đã xác nhận)
  onConfirm: () => unknown; // có thể trả Promise: hộp thoại đợi xong mới đóng
};

type State = { request: ConfirmRequest | null; close: () => void };

export const useConfirmStore = create<State>()((set) => ({
  request: null,
  close: () => set({ request: null }),
}));

export const askConfirm = (request: ConfirmRequest) => useConfirmStore.setState({ request });

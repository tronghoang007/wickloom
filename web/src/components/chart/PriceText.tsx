import { splitPrice } from "@/trading/quote";

/** Giá kiểu TradingView: chữ số cuối (pipette) nhỏ và nâng lên, ví dụ 4,087.44⁰. Nâng bằng `relative` (không dùng align-top) để không làm cao dòng, nên không đè lên nhãn Sell / Buy phía trên. */
export default function PriceText({ value, digits }: { value: number; digits: number }) {
  const [main, pip] = splitPrice(value, digits);
  return (
    <>
      {main}
      {pip && <sup className="relative -top-[0.5em] ml-px align-baseline text-[0.62em] leading-none">{pip}</sup>}
    </>
  );
}

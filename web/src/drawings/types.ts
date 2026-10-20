export type DrawingType = string;

export type Anchor = { time: number; price: number };

export type Drawing = {
  id: string;
  type: DrawingType;
  points: Anchor[];
  color: string;
  width: number;
  dash?: 0 | 1 | 2; // 0 liền, 1 đứt, 2 chấm
  textColor?: string;
  text?: string;
  opts?: Record<string, number | string | boolean>;
  locked: boolean;
  hidden: boolean;
};

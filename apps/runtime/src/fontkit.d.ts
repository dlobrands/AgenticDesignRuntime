declare module "fontkit" {
  export type Font = {
    familyName?: string;
    subfamilyName?: string;
    postscriptName?: string;
    italicAngle?: number;
    OS2?: { usWeightClass?: number };
  };
  export function create(buffer: Uint8Array, postscriptName?: string): Font;
}

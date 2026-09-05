import { PDFArray, PDFDocument, PDFName, PDFNumber, rgb } from "pdf-lib";
import type { PDFRawStream } from "pdf-lib";
import sharp from "sharp";

export type CmykPdfResult = {
  bytes: Uint8Array;
  widthPoints: number;
  heightPoints: number;
  trimBox: [number, number, number, number];
  bleedBox: [number, number, number, number];
  cmykJpeg: Buffer;
};

const mmToPoints = (millimeters: number): number => (millimeters / 25.4) * 72;

export const createCmykPdf = async (input: {
  png: Uint8Array;
  iccProfilePath: string;
  trimWidthPixels: number;
  trimHeightPixels: number;
  dpi: number;
  bleedMm: number;
  cropMarks: boolean;
  title: string;
}): Promise<CmykPdfResult> => {
  const cmykJpeg = await sharp(input.png)
    .flatten({ background: "#FFFFFF" })
    .withIccProfile(input.iccProfilePath, { attach: true })
    .toColourspace("cmyk")
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const metadata = await sharp(cmykJpeg).metadata();
  if (
    metadata.space !== "cmyk" ||
    metadata.channels !== 4 ||
    !metadata.hasProfile
  )
    throw new Error(
      "ICC conversion did not produce profiled four-channel CMYK.",
    );

  const bleedPoints = mmToPoints(input.bleedMm);
  const trimWidthPoints = (input.trimWidthPixels / 96) * 72;
  const trimHeightPoints = (input.trimHeightPixels / 96) * 72;
  const widthPoints = trimWidthPoints + bleedPoints * 2;
  const heightPoints = trimHeightPoints + bleedPoints * 2;
  const trimBox: [number, number, number, number] = [
    bleedPoints,
    bleedPoints,
    bleedPoints + trimWidthPoints,
    bleedPoints + trimHeightPoints,
  ];
  const bleedBox: [number, number, number, number] = [
    0,
    0,
    widthPoints,
    heightPoints,
  ];

  const document = await PDFDocument.create();
  document.setTitle(input.title);
  document.setProducer("Agentic Design Runtime");
  document.setCreator("Agentic Design Runtime");
  const page = document.addPage([widthPoints, heightPoints]);
  const image = await document.embedJpg(cmykJpeg);
  await image.embed();
  const iccBytes = metadata.icc;
  if (!iccBytes) throw new Error("Converted CMYK image has no ICC bytes.");
  const iccStream = document.context.flateStream(iccBytes, {
    N: PDFNumber.of(4),
    Alternate: PDFName.of("DeviceCMYK"),
  });
  const iccReference = document.context.register(iccStream);
  const imageStream = document.context.lookup(image.ref) as PDFRawStream;
  imageStream.dict.set(
    PDFName.of("ColorSpace"),
    document.context.obj([PDFName.of("ICCBased"), iccReference]),
  );
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: widthPoints,
    height: heightPoints,
  });
  page.node.set(PDFName.of("TrimBox"), document.context.obj(trimBox));
  page.node.set(PDFName.of("BleedBox"), document.context.obj(bleedBox));
  if (input.cropMarks && bleedPoints > 0) {
    const length = Math.min(12, bleedPoints * 0.75);
    const thickness = 0.5;
    const color = rgb(0, 0, 0);
    const [left, bottom, right, top] = trimBox;
    for (const x of [left, right]) {
      page.drawLine({
        start: { x, y: 0 },
        end: { x, y: length },
        thickness,
        color,
      });
      page.drawLine({
        start: { x, y: heightPoints - length },
        end: { x, y: heightPoints },
        thickness,
        color,
      });
    }
    for (const y of [bottom, top]) {
      page.drawLine({
        start: { x: 0, y },
        end: { x: length, y },
        thickness,
        color,
      });
      page.drawLine({
        start: { x: widthPoints - length, y },
        end: { x: widthPoints, y },
        thickness,
        color,
      });
    }
  }
  const mediaBox = PDFArray.withContext(document.context);
  bleedBox.forEach((value) => mediaBox.push(PDFNumber.of(value)));
  page.node.set(PDFName.of("MediaBox"), mediaBox);
  return {
    bytes: await document.save({ useObjectStreams: false }),
    widthPoints,
    heightPoints,
    trimBox,
    bleedBox,
    cmykJpeg,
  };
};

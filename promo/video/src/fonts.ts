import { continueRender, delayRender, staticFile } from 'remotion';

export type FontFaceSpec = {
  readonly role: 'sans' | 'mono';
  readonly family: string;
  readonly file: string;
  readonly weight: string;
  readonly style: string;
};

export const FONT_FACES: readonly FontFaceSpec[] = [
  {
    role: 'sans',
    family: 'Noto Sans SC',
    file: 'NotoSansSC-subset.woff2',
    weight: '400',
    style: 'normal',
  },
  {
    role: 'mono',
    family: 'Fira Code',
    file: 'Mono-subset.woff2',
    weight: '400',
    style: 'normal',
  },
];

export const FONT_FAMILIES = {
  sans: FONT_FACES[0].family,
  mono: FONT_FACES[1].family,
} as const;

const STYLE_ELEMENT_ID = 'bundled-font-faces';

const fontFaceCss = (baseUrl: string): string =>
  FONT_FACES.map(
    (face) =>
      `@font-face{font-family:"${face.family}";` +
      `src:url("${baseUrl}${face.file}") format("woff2");` +
      `font-weight:${face.weight};font-style:${face.style};font-display:block;}`,
  ).join('\n');

export const loadFonts = async (
  baseUrl: string = staticFile('fonts/'),
): Promise<string[]> => {
  if (typeof document === 'undefined') {
    return [];
  }

  if (!document.getElementById(STYLE_ELEMENT_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    style.textContent = fontFaceCss(baseUrl);
    document.head.appendChild(style);
  }

  const handle = delayRender('loadFonts');
  try {
    await Promise.all(
      FONT_FACES.map((face) =>
        document.fonts.load(`${face.weight} 16px "${face.family}"`, '地基引擎 Aa0'),
      ),
    );
    await document.fonts.ready;
  } catch (error) {
    continueRender(handle);
    throw error;
  }
  continueRender(handle);

  return FONT_FACES.filter((face) =>
    document.fonts.check(`${face.weight} 16px "${face.family}"`),
  ).map((face) => face.family);
};

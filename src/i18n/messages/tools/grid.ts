// Messages for Create a Grid (src/components/grid/). English is the source and must match
// the original text exactly; Hebrew has exactly the same keys, placeholders
// and tags (src/i18n/messages.test.ts). Text drawn on canvases or into
// exported files, units, colour codes and product names are not translated.
//
// Sizes (3×3, 40×50 cm) read left to right in every language: in Hebrew a
// LEFT-TO-RIGHT MARK (‎) before "×" keeps "40×50 cm" in that order
// instead of letting right-to-left text reverse it to "cm 50×40".

export const gridEn = {
  task: {
    empty: 'Transfer a reference to canvas square by square',
    withImage: '{columns}×{rows} grid on a {width}×{height} {unit} canvas — draw the same grid on yours',
  },
  empty: {
    heading: 'Copy your reference square by square',
    step1: 'Upload your reference photo.',
    step2: 'Pick a grid (4×4 is a good start) and your canvas size.',
    step3: 'Save it, then draw the same grid lightly on your canvas.',
    upload: 'Upload reference photo',
  },
  replaceImage: 'Replace image',
  saveTitle: 'Save grid',
  saveImage: 'Save grid image',
  /** Phones: the two panels under the grid. */
  panel: {
    preset: 'Preset',
    customize: 'Customize',
  },
  sidebar: {
    grid: 'Grid',
    customize: 'Customize grid & canvas',
  },
  fit: {
    label: 'Image fit',
    fit: 'Fit',
    fill: 'Fill',
    center: 'Center',
  },
  presets: {
    label: 'Grid preset',
    option: '{n} by {n} grid ({note})',
    notes: {
      simple: 'Simple',
      recommended: 'Recommended',
      detailed: 'Detailed',
    },
  },
  /** Desktop bar under the grid. */
  summary: '{width}×{height} {unit} · {columns}×{rows} grid',
  controls: {
    canvasSize: 'Canvas Size',
    width: 'Width',
    height: 'Height',
    quickRatios: 'Quick Ratios',
    divisions: 'Grid Divisions',
    columns: 'Cols: {count}',
    rows: 'Rows: {count}',
    lineStyle: 'Line Style',
    opacity: 'Opacity: {value}%',
    thickness: 'Thickness: {value}px',
    imageScale: 'Image Scale',
    centerImage: 'Center image',
  },
};

export const gridHe: typeof gridEn = {
  task: {
    empty: 'להעביר תמונת ייחוס אל הבד, משבצת אחר משבצת',
    withImage: 'רשת {columns}‎×{rows} על בד {width}‎×{height} {unit} — לשרטט את אותה רשת על הבד שלך',
  },
  empty: {
    heading: 'להעתיק את תמונת הייחוס משבצת אחר משבצת',
    step1: 'להעלות את תמונת הייחוס.',
    step2: 'לבחור רשת (4×4 היא התחלה טובה) ואת גודל הבד.',
    step3: 'לשמור, ואז לשרטט בקווים עדינים את אותה רשת על הבד.',
    upload: 'להעלות תמונת ייחוס',
  },
  replaceImage: 'החלפת התמונה',
  saveTitle: 'שמירת הרשת',
  saveImage: 'שמירת תמונת הרשת',
  panel: {
    preset: 'רשת מוכנה',
    customize: 'התאמה אישית',
  },
  sidebar: {
    grid: 'רשת',
    customize: 'התאמת הרשת והבד',
  },
  fit: {
    label: 'תמונה',
    fit: 'התאמה',
    fill: 'מילוי',
    center: 'מרכוז',
  },
  presets: {
    label: 'רשת מוכנה',
    option: 'רשת {n} על {n} ({note})',
    notes: {
      simple: 'פשוטה',
      recommended: 'מומלצת',
      detailed: 'מפורטת',
    },
  },
  summary: '{width}‎×{height} {unit} · רשת {columns}‎×{rows}',
  controls: {
    canvasSize: 'גודל הבד',
    width: 'רוחב',
    height: 'גובה',
    quickRatios: 'יחסים נפוצים',
    divisions: 'חלוקת הרשת',
    columns: 'עמודות: {count}',
    rows: 'שורות: {count}',
    lineStyle: 'סגנון הקו',
    opacity: 'אטימות: {value}%',
    thickness: 'עובי הקו: {value}px',
    imageScale: 'גודל התמונה',
    centerImage: 'מרכוז התמונה',
  },
};

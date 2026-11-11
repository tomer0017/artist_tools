// Messages for the parts the five tools share: the tool header, the image
// upload, the save sheet, the Pro notice, the guided tours (and their texts
// for Study, Color and Grid) and the tools' illustrations. English is the
// source and must match the original text exactly; Hebrew has exactly the
// same keys, placeholders and tags (src/i18n/messages.test.ts). Text drawn on
// canvases or into exported files, units and product names are not translated.

export const commonEn = {
  header: {
    showTutorial: 'Show tutorial',
    progress: 'Progress',
  },
  upload: {
    unsupported: 'Unsupported file type. Please choose an image.',
    readFailed: 'Failed to read image file.',
    button: 'Upload image',
    drop: 'Drop an image here or click to upload',
    formats: 'PNG, JPG, WEBP supported',
  },
  save: {
    toPhotos: 'Save to Photos',
    closePreview: 'Close preview',
    toSaveAlt: '{kind, select, gif {GIF to save} other {Image to save}}',
    pressAndHold: '{kind, select, gif {Press and hold the gif, then choose Save to Photos.} other {Press and hold the image, then choose Save to Photos.}}',
    dismiss: 'Dismiss',
    close: 'Close',
    title: '{kind, select, gif {Save GIF} other {Save Image}}',
    previewAlt: '{kind, select, gif {GIF preview} other {Image preview}}',
    nextScreen: '{kind, select, gif {In the next screen, choose Save GIF.} other {In the next screen, choose Save Image.}}',
    saveKind: '{kind, select, gif {Save GIF} other {Save Image}}',
    open: '{kind, select, gif {Open GIF} other {Open Image}}',
    share: 'Share',
    saveFile: 'Save file',
    shareFailed: 'Could not open the share sheet. Try “Open” and long-press to save.',
  },
  pro: {
    partOfPro: '{name} are part of Pro',
    optionPartOfPro: 'This option is part of Pro',
    notIncluded: 'Your plan does not include it.',
    comingSoon: 'Pro is coming soon and cannot be bought yet. Everything else here stays free.',
    comparePlans: 'Compare plans',
    dismiss: 'Dismiss',
    large: {
      name: 'Large GIFs',
      what: 'Saves your comparison GIF at up to 800 px: sharp enough to share online, show a student or print.',
      why: 'Free includes small and medium GIFs, which cover everyday checks. Large, high-detail exports are one of the extras planned for Pro.',
    },
    difference: {
      name: 'Compare + Difference GIFs',
      what: 'Adds a frame that highlights exactly where your painting differs from the reference, so corrections are easy to see and to explain.',
      why: 'Free includes the opacity pulse and blink animations. Analysis animations like this one are part of Pro.',
    },
  },
  tour: {
    close: 'Close',
    skip: 'Skip',
    showMe: 'Show me how',
    gotIt: 'Got it',
    guidedTour: 'Guided tour',
    endTour: 'End tour',
    back: 'Back',
    next: 'Next',
    done: 'Done',
    stepOf: '{step} / {total}',
    example: '{label} example',
  },
  tours: {
    value: {
      title: 'Value Study',
      tagline: 'Turn any reference into color groups, value maps and a clean drawing guide.',
      preview: { original: 'Original', color: 'Color', values: 'Values', sketch: 'Sketch' },
      steps: {
        modes: { title: 'Pick a study', body: 'Switch Color, Values or Sketch — each answers a different question.' },
        levels: { title: 'Choose value groups', body: 'Fewer groups simplify the masses; more separate subtle transitions.' },
        inline: { title: 'Tune the read', body: 'Adjust contrast and brightness — or sketch detail — right under the image.' },
        save: { title: 'Save your study', body: 'Export the processed image, the palette or a full study sheet.' },
      },
    },
    color: {
      title: 'Color Studio',
      tagline: 'Find, mix and harmonize colors — from the wheel to ready-made paint recipes.',
      preview: { wheel: 'Pick', color: 'Harmonies', original: 'From a photo' },
      steps: {
        wheel: { title: 'Pick a color', body: 'Drag the ring for hue and the square for shade.' },
        harmonies: { title: 'Build harmonies', body: 'Open Harmonies for complementary, analogous and triadic sets of your color.' },
        recipes: { title: 'Recipes & skin tones', body: 'Mixing and Skin Tones give step-by-step paint recipes.' },
        pick: { title: 'Sample from a photo', body: 'Load a reference and pick colors straight off the image.' },
      },
    },
    grid: {
      title: 'Grid Guide',
      tagline: 'Lay an accurate grid over your canvas and reference to transfer proportions by eye.',
      preview: { original: 'Reference', grid: 'Gridded' },
      steps: {
        size: { title: 'Set your canvas', body: 'Enter your real canvas size or pick a ratio so the grid matches your surface.' },
        divisions: { title: 'Choose divisions', body: 'More rows and columns give finer, more precise cells.' },
        canvas: { title: 'Fit your image', body: 'Drag, pinch or use Fit / Fill to place the reference in the frame.' },
        export: { title: 'Save the grid', body: 'Export a printable grid to draw the same lines on your canvas.' },
      },
    },
  },
  art: {
    measure: 'Portrait with purple measurement lines and sizes',
    value: 'The same portrait as photo, color groups, values and sketch',
    color: 'Color wheel with paint on a palette',
    grid: 'Portrait with a 4 by 4 drawing grid',
    compare: 'Pencil artwork beside the reference photo with a comparison slider',
  },
};

export const commonHe: typeof commonEn = {
  header: {
    showTutorial: 'הצגת ההדרכה',
    progress: 'התקדמות',
  },
  upload: {
    unsupported: 'סוג הקובץ לא נתמך. צריך לבחור תמונה.',
    readFailed: 'לא הצלחנו לקרוא את קובץ התמונה.',
    button: 'העלאת תמונה',
    drop: 'אפשר לגרור לכאן תמונה, או ללחוץ כדי להעלות',
    formats: 'נתמכים קבצי PNG, JPG, WEBP',
  },
  save: {
    toPhotos: 'שמירה בתמונות',
    closePreview: 'סגירת התצוגה',
    toSaveAlt: '{kind, select, gif {GIF לשמירה} other {תמונה לשמירה}}',
    pressAndHold: '{kind, select, gif {לחיצה ארוכה על ה-GIF, ואז לבחור שמירה בתמונות.} other {לחיצה ארוכה על התמונה, ואז לבחור שמירה בתמונות.}}',
    dismiss: 'סגירה',
    close: 'סגירה',
    title: '{kind, select, gif {שמירת ה-GIF} other {שמירת התמונה}}',
    previewAlt: '{kind, select, gif {תצוגה מקדימה של ה-GIF} other {תצוגה מקדימה של התמונה}}',
    nextScreen: '{kind, select, gif {במסך הבא יש לבחור שמירת ה-GIF.} other {במסך הבא יש לבחור שמירת התמונה.}}',
    saveKind: '{kind, select, gif {שמירת ה-GIF} other {שמירת התמונה}}',
    open: '{kind, select, gif {פתיחת ה-GIF} other {פתיחת התמונה}}',
    share: 'שיתוף',
    saveFile: 'שמירת הקובץ',
    shareFailed: 'לא הצלחנו לפתוח את חלון השיתוף. אפשר לבחור "פתיחה" וללחוץ לחיצה ארוכה כדי לשמור.',
  },
  pro: {
    partOfPro: '{name} — חלק ממסלול Pro',
    optionPartOfPro: 'האפשרות הזו היא חלק ממסלול Pro',
    notIncluded: 'המסלול הנוכחי לא כולל אותה.',
    comingSoon: 'Pro יגיע בקרוב ועדיין אי אפשר לרכוש אותו. כל השאר כאן נשאר חינמי.',
    comparePlans: 'השוואת מסלולים',
    dismiss: 'סגירה',
    large: {
      name: 'GIF גדול',
      what: 'שומר את ה-GIF של ההשוואה ברוחב של עד 800 פיקסלים: חד מספיק לשיתוף ברשת, להצגה לתלמידים או להדפסה.',
      why: 'המסלול החינמי כולל GIF קטן ובינוני, שמספיקים לבדיקות היומיומיות. ייצוא גדול ומפורט הוא אחת התוספות המתוכננות ל-Pro.',
    },
    difference: {
      name: 'GIF השוואה + הבדלים',
      what: 'מוסיף פריים שמדגיש בדיוק איפה הציור שונה מתמונת הייחוס, כך שקל לראות את התיקונים ולהסביר אותם.',
      why: 'המסלול החינמי כולל את הנפשות השקיפות המתחלפת וההבהוב. הנפשות ניתוח כמו זו הן חלק מ-Pro.',
    },
  },
  tour: {
    close: 'סגירה',
    skip: 'דילוג',
    showMe: 'להדרכה',
    gotIt: 'הבנתי',
    guidedTour: 'סיור מודרך',
    endTour: 'סיום הסיור',
    back: 'חזרה',
    next: 'הבא',
    done: 'סיום',
    stepOf: '{step} / {total}',
    example: 'דוגמה: {label}',
  },
  tours: {
    value: {
      title: 'לימוד ערכים',
      tagline: 'כל תמונת ייחוס הופכת לקבוצות צבע, למפת ערכים ולמדריך רישום נקי.',
      preview: { original: 'מקור', color: 'צבע', values: 'ערכים', sketch: 'סקיצה' },
      steps: {
        modes: { title: 'בחירת לימוד', body: 'מעבר בין צבע, ערכים וסקיצה — כל אחד עונה על שאלה אחרת.' },
        levels: { title: 'בחירת קבוצות ערכים', body: 'פחות קבוצות מפשטות את המסות; יותר קבוצות מפרידות מעברים עדינים.' },
        inline: { title: 'כוונון הקריאה', body: 'אפשר לכוונן ניגודיות ובהירות — או את פירוט הסקיצה — ממש מתחת לתמונה.' },
        save: { title: 'שמירת הלימוד', body: 'ייצוא התמונה המעובדת, הפלטה או דף לימוד מלא.' },
      },
    },
    color: {
      title: 'סטודיו צבע',
      tagline: 'מציאה, ערבוב והרמוניה של צבעים — מהגלגל ועד מתכוני צבע מוכנים.',
      preview: { wheel: 'בחירה', color: 'הרמוניות', original: 'מתצלום' },
      steps: {
        wheel: { title: 'בחירת צבע', body: 'גוררים את הטבעת לבחירת הגוון, ואת הריבוע לבחירת הבהירות והרוויה.' },
        harmonies: { title: 'בניית הרמוניות', body: 'בלשונית הרמוניות: סטים משלימים, אנלוגיים וטריאדיים של הצבע.' },
        recipes: { title: 'מתכונים וגווני עור', body: 'ערבוב וגווני עור נותנים מתכוני צבע צעד אחר צעד.' },
        pick: { title: 'דגימה מתצלום', body: 'אפשר לטעון תמונת ייחוס ולדגום צבעים ישירות מהתמונה.' },
      },
    },
    grid: {
      title: 'מדריך רשת',
      tagline: 'רשת מדויקת על הבד ועל תמונת הייחוס, כדי להעביר פרופורציות בעין.',
      preview: { original: 'ייחוס', grid: 'עם רשת' },
      steps: {
        size: { title: 'הגדרת הבד', body: 'מזינים את מידות הבד האמיתיות או בוחרים יחס, כדי שהרשת תתאים למשטח.' },
        divisions: { title: 'בחירת חלוקה', body: 'יותר שורות ועמודות נותנות משבצות קטנות ומדויקות יותר.' },
        canvas: { title: 'התאמת התמונה', body: 'גרירה, צביטה, או התאמה / מילוי ממקמים את תמונת הייחוס במסגרת.' },
        export: { title: 'שמירת הרשת', body: 'ייצוא רשת להדפסה, כדי לשרטט את אותם קווים על הבד.' },
      },
    },
  },
  art: {
    measure: 'דיוקן עם קווי מדידה סגולים ומידות',
    value: 'אותו דיוקן כתצלום, כקבוצות צבע, כערכים וכסקיצה',
    color: 'גלגל צבעים עם צבע על פלטה',
    grid: 'דיוקן עם רשת רישום של 4 על 4',
    compare: 'ציור בעיפרון לצד תצלום הייחוס עם מחוון השוואה',
  },
};

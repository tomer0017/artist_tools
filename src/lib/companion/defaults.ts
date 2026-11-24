import { ANIMATIONS, COMPANION_FEATURES, FREQUENCY_PRESETS, type AnimationId, type CompanionConfig, type CompanionFeature, type CompanionSettings, type CompanionTip, type TipAction } from './model';

// ─── Sketchy's defaults (ADR-0024) ────────────────────────────────────────────
// What applies until an admin saves anything in Admin → Companion: on for
// everyone, a balanced pace, every animation, and a starter set of tips. The
// tips are the app's own words (not gated content), in English and Hebrew;
// the Hebrew addresses the reader without gender, while Sketchy speaks of
// himself in the masculine. Admins edit, copy, archive and add to them; the
// first save publishes version 1 of the `companion` configuration.

export const DEFAULT_SETTINGS: CompanionSettings = {
  enabled: true,
  size: 100,
  frequency: 'balanced',
  firstDelaySec: 2,
  ...FREQUENCY_PRESETS.balanced,
  snoozeHours: 24,
  wander: true,
  wanderEverySec: 70,
  idleLife: true,
  celebrate: true,
  restAfterSec: 240,
  speed: 100,
  animations: Object.fromEntries(ANIMATIONS.map((id) => [id, true])) as Record<AnimationId, boolean>,
};

export const DEFAULT_ACCESS: Record<CompanionFeature, 'free'> = Object.fromEntries(COMPANION_FEATURES.map((f) => [f, 'free'])) as Record<CompanionFeature, 'free'>;

const L = (en: string, he: string) => ({ en, he });
const button = (type: TipAction['type'], en: string, he: string, extra: Partial<TipAction> = {}): TipAction => ({ type, label: L(en, he), ...extra });
const NONE: TipAction = { type: 'none', label: L('', '') };

type Draft = Omit<CompanionTip, 'id' | 'order' | 'access' | 'weight' | 'screens' | 'audience'> & Partial<Pick<CompanionTip, 'access' | 'weight' | 'screens' | 'audience'>>;

const DRAFTS: Draft[] = [
  // ── Welcome ──
  {
    category: 'welcome',
    trigger: 'firstVisit',
    animation: 'wave',
    title: L('Hi, I’m Sketchy!', 'היי, אני סקצ׳י!'),
    text: L(
      'I know every tool in this studio. Tap me whenever you want an idea, a drawing tip or a helping paw.',
      'אני מכיר כל כלי בסטודיו הזה. אפשר להקיש עליי בכל פעם שרוצים רעיון, טיפ לרישום או כפה עוזרת.',
    ),
    action: button('chooseTool', 'Show me around', 'מה יש כאן?'),
    weight: 10,
  },
  {
    category: 'welcome',
    trigger: 'arrive',
    animation: 'wave',
    text: L('Welcome back! Ready to draw something today?', 'ברוכים השבים! מוכנים לרשום משהו היום?'),
    action: button('roulette', 'Spin a challenge', 'להגריל אתגר', { mood: 'surprise' }),
    weight: 6,
  },
  {
    category: 'practice',
    trigger: 'arrive',
    animation: 'draw',
    audience: ['student'],
    text: L('Good to see you! Your next lesson is waiting for you.', 'כיף לראות אתכם! השיעור הבא כבר מחכה.'),
    action: button('nextLesson', 'Open my next lesson', 'לשיעור הבא שלי'),
    weight: 7,
  },
  // ── The brief's own suggestions ──
  {
    category: 'inspiration',
    trigger: 'idle',
    animation: 'think',
    text: L('Not sure what to draw today? Let’s spin the challenge roulette!', 'לא בטוחים מה לרשום היום? בואו נסובב את רולטת האתגרים!'),
    action: button('roulette', 'Spin the roulette', 'לסובב את הרולטה', { mood: 'surprise' }),
    weight: 8,
  },
  {
    category: 'practice',
    trigger: 'idle',
    animation: 'draw',
    text: L('Let’s sharpen your drawing skills! I’ll find a useful exercise for you.', 'בואו נחדד את כישורי הרישום! אמצא בשבילכם תרגיל מועיל.'),
    action: button('nextLesson', 'Find me an exercise', 'למצוא לי תרגיל'),
    weight: 7,
  },
  {
    category: 'tools',
    trigger: 'idle',
    animation: 'point',
    text: L('How is your drawing coming along? Let’s compare it with your reference!', 'איך מתקדם הציור? בואו נשווה אותו לתמונת הייחוס!'),
    action: button('openTool', 'Open Compare & Correct', 'לפתוח את השוואה ותיקון', { tool: 'compare' }),
    weight: 6,
  },
  {
    category: 'tools',
    trigger: 'idle',
    animation: 'curious',
    text: L('Something feels a little off? Let’s check the proportions and angles together.', 'משהו נראה קצת לא מדויק? בואו נבדוק יחד פרופורציות וזוויות.'),
    action: button('openTool', 'Open Measure & Plan', 'לפתוח את מדידה ותכנון', { tool: 'measure' }),
    weight: 6,
  },
  {
    category: 'light',
    trigger: 'idle',
    animation: 'think',
    text: L(
      'Try looking at your reference in black and white. It makes light and shadow much easier to understand.',
      'כדאי להסתכל על תמונת הייחוס בשחור־לבן. כך הרבה יותר קל להבין אור וצל.',
    ),
    action: button('openTool', 'See the values', 'לראות את הערכים', { tool: 'value' }),
    weight: 7,
  },
  {
    category: 'color',
    trigger: 'idle',
    animation: 'curious',
    text: L('Having trouble mixing that color? Let’s break it down together.', 'קשה לערבב את הגוון הזה? בואו נפרק אותו יחד.'),
    action: button('openTool', 'Open Color & Mixing', 'לפתוח את צבע וערבוב', { tool: 'color' }),
    weight: 6,
  },
  {
    category: 'teaching',
    trigger: 'idle',
    animation: 'holdSign',
    audience: ['teacher'],
    text: L('Planning your next art class? Let’s create printable practice sheets for your students!', 'מתכננים את שיעור האמנות הבא? בואו ניצור דפי תרגול להדפסה בשביל התלמידים!'),
    action: button('worksheets', 'Make practice sheets', 'ליצור דפי תרגול'),
    weight: 8,
  },
  {
    category: 'teaching',
    trigger: 'idle',
    animation: 'think',
    audience: ['teacher'],
    text: L(
      'Let’s randomly choose a drawing challenge, and I’ll help you prepare practice sheets for the class.',
      'בואו נגריל אתגר רישום, ואני אעזור להכין דפי תרגול לכיתה.',
    ),
    action: button('classRoulette', 'Spin for the class', 'להגריל לכיתה'),
    weight: 8,
  },
  // ── Tools ──
  {
    category: 'tools',
    trigger: 'idle',
    animation: 'point',
    text: L(
      'Copying a tricky photo? A grid splits it into small squares, so you only ever draw one simple square at a time.',
      'מעתיקים תצלום מסובך? רשת מחלקת אותו למשבצות קטנות, וכך רושמים כל פעם רק משבצת אחת פשוטה.',
    ),
    action: button('openTool', 'Open Create a Grid', 'לפתוח את יצירת רשת', { tool: 'grid' }),
    weight: 5,
  },
  {
    category: 'light',
    trigger: 'idle',
    animation: 'curious',
    text: L(
      'Squint at your reference! Study & Simplify shows the big shapes of light and dark before any detail.',
      'כדאי לצמצם עיניים מול תמונת הייחוס! ב״לימוד ופישוט״ רואים את הצורות הגדולות של אור וצל לפני כל פרט.',
    ),
    action: button('openTool', 'Open Study & Simplify', 'לפתוח את לימוד ופישוט', { tool: 'value' }),
    weight: 5,
  },
  {
    category: 'tools',
    trigger: 'idle',
    animation: 'think',
    text: L(
      'Measure one thing you know, like a head or a door, and everything else falls into proportion.',
      'מודדים דבר אחד שמכירים, כמו ראש או דלת, וכל השאר מסתדר בפרופורציה.',
    ),
    action: button('openTool', 'Open Measure & Plan', 'לפתוח את מדידה ותכנון', { tool: 'measure' }),
    weight: 4,
  },
  {
    category: 'color',
    trigger: 'idle',
    animation: 'holdSign',
    text: L('Looking for colors that sing together? Pick one on the wheel and see its harmonies.', 'מחפשים צבעים שמתאימים זה לזה? בוחרים צבע על הגלגל ורואים את ההרמוניות שלו.'),
    action: button('openTool', 'Open Color & Mixing', 'לפתוח את צבע וערבוב', { tool: 'color' }),
    weight: 4,
  },
  {
    category: 'tools',
    trigger: 'idle',
    animation: 'laugh',
    text: L('Lay your drawing over the reference and blink between them: the differences jump right out.', 'מניחים את הציור על תמונת הייחוס ומהבהבים ביניהם: ההבדלים קופצים לעין.'),
    action: button('openTool', 'Open Compare & Correct', 'לפתוח את השוואה ותיקון', { tool: 'compare' }),
    weight: 4,
  },
  {
    category: 'color',
    trigger: 'idle',
    animation: 'draw',
    text: L('Painting a portrait? Color & Mixing has skin-tone mixes for light, medium and deep tones.', 'מציירים דיוקן? ב״צבע וערבוב״ יש מתכונים לגווני עור בהירים, בינוניים וכהים.'),
    action: button('openTool', 'Open Color & Mixing', 'לפתוח את צבע וערבוב', { tool: 'color' }),
    weight: 3,
  },
  // ── After a save, after a completion ──
  {
    category: 'celebration',
    trigger: 'afterSave',
    animation: 'celebrate',
    text: L('Lovely work! Keep the streak going with a quick challenge?', 'עבודה יפה! להמשיך את הרצף עם אתגר קצר?'),
    action: button('roulette', 'Something light', 'משהו קליל', { mood: 'light' }),
    weight: 5,
  },
  {
    category: 'tools',
    trigger: 'afterSave',
    animation: 'point',
    afterTools: ['value'],
    text: L('Values clearer now? A grid can help you move them onto paper.', 'הערכים ברורים יותר עכשיו? רשת יכולה לעזור להעביר אותם אל הנייר.'),
    action: button('openTool', 'Open Create a Grid', 'לפתוח את יצירת רשת', { tool: 'grid' }),
    weight: 7,
  },
  {
    category: 'tools',
    trigger: 'afterSave',
    animation: 'point',
    afterTools: ['grid'],
    text: L('Grid ready! When your drawing is done, compare it with the reference.', 'הרשת מוכנה! כשהרישום גמור, אפשר להשוות אותו לתמונת הייחוס.'),
    action: button('openTool', 'Open Compare & Correct', 'לפתוח את השוואה ותיקון', { tool: 'compare' }),
    weight: 7,
  },
  {
    category: 'celebration',
    trigger: 'afterComplete',
    animation: 'celebrate',
    screens: ['home', 'learn'],
    text: L('You did it! One more lesson while your hand is warm?', 'הצלחתם! עוד שיעור אחד כל עוד היד חמה?'),
    action: button('nextLesson', 'Next lesson', 'לשיעור הבא'),
    weight: 6,
  },
  {
    category: 'celebration',
    trigger: 'afterComplete',
    animation: 'jump',
    screens: ['home', 'learn'],
    text: L('Challenge complete! Want another one to keep the fun going?', 'האתגר הושלם! עוד אחד כדי להמשיך בכיף?'),
    action: button('roulette', 'Spin again', 'להגריל שוב', { mood: 'surprise' }),
    weight: 6,
  },
  // ── Practice, Learn ──
  {
    category: 'practice',
    trigger: 'idle',
    animation: 'laugh',
    text: L('Five minutes count! Spin something light and draw it before your coffee cools.', 'גם חמש דקות נחשבות! מגרילים משהו קליל ורושמים אותו לפני שהקפה מתקרר.'),
    action: button('roulette', 'Something light', 'משהו קליל', { mood: 'light' }),
    weight: 5,
  },
  {
    category: 'practice',
    trigger: 'idle',
    animation: 'draw',
    audience: ['student'],
    text: L('Practice makes progress. Shall we pick up where you left off in the course?', 'תרגול מביא התקדמות. להמשיך בקורס מהמקום שבו עצרנו?'),
    action: button('nextLesson', 'Continue the course', 'להמשיך בקורס'),
    weight: 6,
  },
  {
    category: 'inspiration',
    trigger: 'idle',
    animation: 'curious',
    screens: ['learn'],
    text: L('Can’t decide? Let the roulette choose your next challenge!', 'קשה להחליט? שהרולטה תבחר את האתגר הבא!'),
    action: button('roulette', 'Spin', 'להגריל', { mood: 'surprise' }),
    weight: 6,
  },
  {
    category: 'inspiration',
    trigger: 'idle',
    animation: 'jump',
    screens: ['learn'],
    text: L('Feeling brave today? Try a “Challenge me!” spin.', 'מרגישים אמיצים היום? אפשר לנסות הגרלה של ״תאתגרו אותי!״.'),
    action: button('roulette', 'Challenge me!', 'תאתגרו אותי!', { mood: 'challenge' }),
    weight: 4,
  },
  {
    category: 'teaching',
    trigger: 'arrive',
    animation: 'holdSign',
    audience: ['teacher'],
    screens: ['home', 'learn'],
    text: L(
      'Teaching from one screen? Class mode keeps your own history out of it while students take turns.',
      'מלמדים ממסך אחד? מצב כיתה שומר את ההיסטוריה האישית בצד בזמן שהתלמידים מתחלפים.',
    ),
    action: button('openLearn', 'Open Learn', 'לפתוח את ״ללמוד לרשום״', { page: 'home' }),
    weight: 5,
  },
  // ── Drawing tips (only when asked: "Give me a drawing tip") ──
  ...(
    [
      ['Start with the big shapes. Block in the whole subject lightly before any detail.', 'מתחילים מהצורות הגדולות: משרטטים בעדינות את כל הנושא לפני כל פרט.'],
      ['Draw lightly at first. A light line is easy to fix; a dark one is not.', 'רושמים בעדינות בהתחלה. קו בהיר קל לתקן, קו כהה הרבה פחות.'],
      ['Look at your subject more than at your paper. Your eyes belong on the subject most of the time.', 'מסתכלים על הנושא יותר מאשר על הדף. רוב הזמן העיניים צריכות להיות על מה שרושמים.'],
      ['Draw the negative spaces. The shapes around and between things are often easier to see.', 'רושמים את החללים השליליים: הצורות שמסביב לדברים ובין הדברים לרוב קלות יותר לראות.'],
      ['Find the angles: lay your pencil along an edge, then copy that tilt onto the paper.', 'מוצאים את הזוויות: מניחים את העיפרון לאורך קצה, ומעתיקים את אותה הטיה אל הדף.'],
      ['Shadows have edges. Some are crisp and some are soft: notice which is which.', 'לצללים יש קצוות. יש חדים ויש רכים, וכדאי לשים לב מי זה מי.'],
      ['Turn the reference upside down and copy it. You will draw shapes, not names.', 'הופכים את תמונת הייחוס ומעתיקים אותה הפוכה. כך רושמים צורות ולא שמות של דברים.'],
      ['Mix more paint than you think you need: matching a color twice is hard.', 'מערבבים יותר צבע ממה שנראה שצריך: קשה לקבל את אותו גוון פעמיים.'],
      ['Hatch in one direction first. Cross-hatch only where it should get darker.', 'מקווקווים קודם בכיוון אחד, ומצליבים קווים רק איפה שצריך להיות כהה יותר.'],
      ['Ellipses are never pointy at the ends. Keep them round and smooth.', 'לאליפסה אין קצוות מחודדים. שומרים עליה עגולה וחלקה.'],
      ['Draw through the form: sketch the hidden side lightly so the object feels solid.', 'רושמים דרך הצורה: משרטטים בעדינות גם את הצד הנסתר, כדי שהחפץ ירגיש מוצק.'],
      ['Save the white of the paper for your brightest highlights.', 'שומרים את הלבן של הדף להארות הבהירות ביותר.'],
      ['The darkest dark next to the lightest light pulls the eye there: use it at your focal point.', 'הכהה ביותר ליד הבהיר ביותר מושך את העין, אז כדאי למקם אותו במוקד הציור.'],
    ] as const
  ).map(([en, he]): Draft => ({ category: 'drawing', trigger: 'menu', animation: 'think', text: L(en, he), action: NONE, weight: 5 })),
  {
    category: 'drawing',
    trigger: 'menu',
    animation: 'curious',
    text: L('Squint! Half-closed eyes merge the small details and show the big lights and darks.', 'מצמצמים עיניים! כשהעיניים חצי עצומות, הפרטים הקטנים מתמזגים והאורות והצללים הגדולים מתגלים.'),
    action: button('openTool', 'See the values', 'לראות את הערכים', { tool: 'value' }),
    weight: 5,
  },
  {
    category: 'drawing',
    trigger: 'menu',
    animation: 'point',
    text: L('Measure with your pencil: hold it at arm’s length and compare one length with another.', 'מודדים עם העיפרון: מחזיקים אותו ביד מושטת ומשווים אורך אחד לאחר.'),
    action: button('openTool', 'Open Measure & Plan', 'לפתוח את מדידה ותכנון', { tool: 'measure' }),
    weight: 5,
  },
  {
    category: 'drawing',
    trigger: 'menu',
    animation: 'think',
    text: L('Step back often. From a distance, mistakes in proportion pop out.', 'מתרחקים מדי פעם. ממרחק, טעויות בפרופורציה בולטות מיד.'),
    action: button('openTool', 'Compare with the reference', 'להשוות לתמונת הייחוס', { tool: 'compare' }),
    weight: 5,
  },
  {
    category: 'drawing',
    trigger: 'menu',
    animation: 'draw',
    text: L('Three values are enough to start: light, middle and dark.', 'שלושה ערכים מספיקים להתחלה: בהיר, בינוני וכהה.'),
    action: button('openTool', 'Try three values', 'לנסות שלושה ערכים', { tool: 'value' }),
    weight: 5,
  },
  {
    category: 'drawing',
    trigger: 'menu',
    animation: 'holdSign',
    text: L('Warm light and cool shadows (or the other way round) make color feel real.', 'אור חם וצללים קרים (או להפך) נותנים לצבע תחושה אמיתית.'),
    action: button('openTool', 'Explore warm and cool', 'לחקור חם וקר', { tool: 'color' }),
    weight: 5,
  },
  {
    category: 'drawing',
    trigger: 'menu',
    animation: 'laugh',
    text: L('Complementary colors side by side make each other look brighter.', 'צבעים משלימים זה לצד זה גורמים זה לזה להיראות בוהקים יותר.'),
    action: button('openTool', 'See complementary colors', 'לראות צבעים משלימים', { tool: 'color' }),
    weight: 5,
  },
  {
    category: 'drawing',
    trigger: 'menu',
    animation: 'draw',
    text: L('A quick two-minute gesture drawing warms up your hand before a longer piece.', 'רישום תנועה מהיר של שתי דקות מחמם את היד לפני עבודה ארוכה.'),
    action: button('roulette', 'Something quick', 'משהו מהיר', { mood: 'light' }),
    weight: 5,
  },
];

export const DEFAULT_TIPS: CompanionTip[] = DRAFTS.map((draft, i) => ({
  id: `T-${String(i + 1).padStart(3, '0')}`,
  order: (i + 1) * 10,
  screens: ['home'],
  audience: [],
  access: 'free',
  weight: 5,
  ...draft,
}));

export function defaultConfig(): CompanionConfig {
  return { settings: structuredClone(DEFAULT_SETTINGS), access: { ...DEFAULT_ACCESS }, tips: structuredClone(DEFAULT_TIPS) };
}

# Learn — review document

**Status: proposal. Nothing is implemented, migrated or deployed.**
Revised on 2026-11-18 after the owner's first review. This page is the short
version for approval; the details are in documents 01–07.

> **Since then (2026-11-19):** M1–M5 are built and on staging (M5: the
> Learn screens, ADR-0018). After M5 the owner approved the M6 design review,
> [08-m6-design-review.md](08-m6-design-review.md), with refinements: it
> revises the curriculum's order and the lesson structure. After seeing M6a,
> the owner approved a beginner revision,
> [09-beginner-revision.md](09-beginner-revision.md): six stages from
> absolute zero, micro-lessons of one small skill, and a much simpler lesson
> page (ADR-0020). The founder's sprint brief then asked for a 15-lesson
> beginner course and a specification through lesson 29:
> [10-beginner-course.md](10-beginner-course.md). Status per milestone: 07.

## 1. Answers to the first review

| # | Request | Answer |
|---|---|---|
| 1 | Commit the planning documents only | Done in `53a53ed`, documents only. This revision is documents only as well |
| 2 | Treat M0 as a separate critical fix | Done: [catalog-rollback-safety.md](../security/catalog-rollback-safety.md). It was reproduced on a throwaway database. It gets its own approval, tests and release, before any Learn milestone that adds a feature |
| 3 | Are all 46 pencil exercises necessary? | No. v1 has 20: 12 core exercises and 8 next steps. 18 are merged into them and 8 are deferred (§2) |
| 4 | Does "First N" mean exercises or units? | Items: exercises (or challenges), never units. v1 has no units. The list is frozen when published, so reordering never changes anyone's access (§5) |
| 5 | Images in MongoDB, or the existing asset storage? | No server-side asset store exists today, and `public/` and the repository are both public. Recommended: files on the server outside the releases, with their metadata in MongoDB, served only after an access check. GridFS is not recommended: every database dump would copy the whole library again (§6, A19) |
| 6 | Can the Plans editor control the curriculum, individual challenges and PDF exports independently? | Not today: it controls only the five tools and the image and GIF saves. Proposed: extend it with five feature rows and a Learn access section for individual items. Each is set independently (§5) |

## 2. The curriculum

**Why 20 and not 46:**

- **Seeing and checking come first.** Accuracy is limited mostly by
  perception and checking, not by the hand (01 §1). Most of the core
  (exercises 2 and 4–8) trains looking, measuring and checking.
- **Hand drills shrink to one warm-up.**
- **Every exercise ends in a real drawing.** Drills are merged into the
  exercise that uses them.
- **Specialised topics move to challenges:** facial features, the
  mannequin, three-point perspective, animals. Challenges repeat with a new
  subject each time.

**Core (12)**

| # | ID | Title | כותרת | What it trains |
|---|---|---|---|---|
| 1 | D-START-01 | A first drawing from life | רישום ראשון מהתבוננות | A baseline; success before drills |
| 2 | D-SHAPE-01 | Big shapes and simple forms | צורות גדולות וגופים פשוטים | The big shape first |
| 3 | D-LINE-04 | Lines and ellipses on a real object | קווים ואליפסות על חפץ אמיתי | Just enough hand control |
| 4 | D-OBS-02 | Negative space | חלל שלילי | Seeing shapes as they are |
| 5 | D-OBS-03 | Angles and alignments | זוויות וקווי יישור | Checking directions and positions |
| 6 | D-OBS-04 | Relative measurement | מדידה יחסית בעזרת העיפרון | Checking proportions |
| 7 | D-OBS-06 | Block-in: from the big shape to the small | חלוקה ראשונית: מהצורה הגדולה לקטנה | From big to small, in segments |
| 8 | D-COPY-02 | A measured copy, checked and corrected | העתקה מדויקת: בדיקה ותיקון | Checking and correcting |
| 9 | D-VAL-01 | Seeing values | לראות ערכים | A value scale and three values |
| 10 | D-LIGHT-01 | Light and shadow on simple objects | אור וצל על חפצים פשוטים | Form in light |
| 11 | D-OBS-07 | A still life from life, start to finish | טבע דומם מהתבוננות, מההתחלה עד הסוף | All of the above, from life |
| 12 | D-HEAD-04 | A portrait from a photo | דיוקן מתצלום | All of the above, on a face |

**Next steps (8)**

| # | ID | Title | כותרת | What it trains |
|---|---|---|---|---|
| 13 | D-COPY-01 | The grid method | שיטת הרשת | Transferring and checking |
| 14 | D-PERSP-01 | Eye level and perspective from observation | קו האופק ופרספקטיבה מהתבוננות | Perspective as a check |
| 15 | D-FIG-01 | Gesture and figure proportions | תנועה ופרופורציות הגוף | The figure |
| 16 | D-FIG-04 | Hands | ידיים | Structure |
| 17 | D-COPY-03 | Constructing and shading an eye | בניית עין והצללתה | Form and value in a detail |
| 18 | D-HEAD-02 | The head turning | הראש בסיבוב: שלושה רבעים ופרופיל | Construction in space |
| 19 | D-SUBJ-02 | Landscape: big shapes and depth | נוף: צורות גדולות ועומק | Planes and depth |
| 20 | D-SUBJ-04 | A complete drawing | רישום שלם מההתחלה עד הסוף | From thumbnails to a finished drawing |

**Colour module (7, separate; pencil first is recommended, never required)**

| ID | Title | כותרת |
|---|---|---|
| C-COL-01 | Hue, value and chroma | גוון, ערך ורוויה |
| C-COL-02 | Mixing with a limited palette | ערבוב בפלטה מצומצמת |
| C-COL-03 | Preparing a canvas | הכנת קנבס |
| C-COL-04 | Transferring the drawing | העברת הרישום לקנבס |
| C-COL-05 | Simplifying into value and colour groups | פישוט לקבוצות ערך וצבע |
| C-COL-06 | Block-in and layers | מסות ראשונות ושכבות |
| C-COL-07 | A small complete painting | ציור קטן ושלם |

**Merged into the 20 (18).** Their IDs stay reserved.

| Now part of | Merged exercises |
|---|---|
| D-LINE-04 | D-LINE-01 Confident straight lines; D-LINE-02 Curves, S-curves and spirals; D-LINE-03 Ellipses |
| D-SHAPE-01 | D-SHAPE-02 Cube, cylinder, sphere, cone; D-SHAPE-03 Objects as combined forms |
| D-OBS-03 | D-OBS-05 Alignments |
| D-VAL-01 | D-VAL-02 Smooth transitions and hatching; D-VAL-03 Seeing three values |
| D-LIGHT-01 | D-LIGHT-02 Planes: box and cylinder; D-LIGHT-03 Cast shadows |
| D-OBS-07 | D-LIGHT-04 Still life in light |
| D-PERSP-01 | D-PERSP-02 Boxes in two-point perspective; D-PERSP-05 Perspective from observation |
| D-COPY-03 | D-COPY-04 An eye in values |
| D-HEAD-04 | D-HEAD-01 Proportions of the head, front view |
| D-FIG-01 | D-FIG-02 Proportions of the figure |
| D-SUBJ-04 | D-VAL-04 Value thumbnails; D-SUBJ-03 Composition in thumbnails |

**Deferred (8).** These are written only if people ask for them.

| Exercise | Covered meanwhile by |
|---|---|
| D-OBS-01 Slow contour | An optional warm-up inside D-START-01 |
| D-PERSP-03 Circles in perspective | D-LINE-04 and D-PERSP-01; CH-005 |
| D-PERSP-04 Three-point perspective | CH-029 |
| D-HEAD-03 Features: nose, mouth, ear | D-HEAD-04; CH-037 and CH-038 |
| D-HEAD-05 Portrait from life | CH-034 and CH-035 |
| D-FIG-03 A simple mannequin | D-FIG-01 |
| D-FIG-05 A figure from life or a photo | CH-044 to CH-047 |
| D-SUBJ-01 Animals from simple shapes | CH-020 to CH-025 |

## 3. The 50 challenges

- **Counts:** 12 beginner (B), 25 intermediate (I), 13 advanced (A); 15
  quick.
- **Medium:** all work in pencil, and 20 also suit colour.
- **Repeatable:** each one can be done again with a different subject.
- **Skill areas and tools:** in [03-challenges.md](03-challenges.md).

| ID | Challenge | עברית | Prompt | Level | Quick | Reference |
|---|---|---|---|---|---|---|
| **Everyday objects** | | | | | | |
| CH-001 | Your shoe | הנעל שלך | Draw one of your shoes from the side. Next time, from above. | I |  | Life |
| CH-002 | Keys on the table | מפתחות על השולחן | Drop your keys on the table and draw them exactly as they landed. | B | ✓ | Life |
| CH-003 | Crumpled paper | נייר מקומט | Crumple a sheet of paper and draw its planes of light and shadow. | A |  | Life |
| CH-004 | Scissors | מספריים | Draw a pair of scissors, starting with the empty shapes inside the handles. | B | ✓ | Life |
| CH-005 | A pair of glasses | משקפיים | Draw a pair of glasses: two lenses, the bridge, and how the arms recede. | I | ✓ | Life |
| CH-006 | Your bag | התיק שלך | Draw your bag or backpack with its folds and straps. | I |  | Life |
| **Still life** | | | | | | |
| CH-007 | Three pieces of fruit | שלושה פירות | Arrange three fruits under one light and draw them. | B |  | Life |
| CH-008 | An egg on a cloth | ביצה על בד | Draw an egg on a folded cloth, lit from one side. | I |  | Life |
| CH-009 | A glass bottle | בקבוק זכוכית | Draw a glass bottle with its reflections and what shows through it. | A |  | Life or Provided |
| CH-010 | Kitchen tools | כלי מטבח | Arrange a few kitchen tools and draw the group. | I |  | Life |
| CH-011 | A stack of books | ערימת ספרים | Draw a small stack of books, slightly turned. | B | ✓ | Life |
| **Plants and flowers** | | | | | | |
| CH-012 | A single leaf | עלה אחד | Draw one leaf: its outline first, then its veins. | B | ✓ | Life |
| CH-013 | A potted plant | צמח בעציץ | Draw a potted plant, using the gaps between the leaves. | I |  | Life |
| CH-014 | A flower up close | פרח מקרוב | Draw one flower large on the page, from the centre outwards. | I |  | Life or Provided |
| CH-015 | A tree from your window | עץ מהחלון | Draw a tree you can see, as a few big masses before any leaves. | B |  | Life |
| CH-016 | A succulent or cactus | סוקולנט או קקטוס | Draw a succulent or a cactus and its repeating shapes. | B | ✓ | Life |
| **Butterflies and insects** | | | | | | |
| CH-017 | A butterfly | פרפר | Draw a butterfly, matching its two sides and its patterns. | B |  | Provided |
| CH-018 | A beetle | חיפושית | Draw a beetle's shiny shell with its highlights. | I |  | Provided |
| CH-019 | A dragonfly or bee | שפירית או דבורה | Draw a dragonfly or a bee, with the fine structure of its wings. | A |  | Provided |
| **Animals** | | | | | | |
| CH-020 | A sleeping pet | חיית מחמד ישנה | Draw a pet while it sleeps: its big masses first. | I | ✓ | Life or Own photo |
| CH-021 | A dog's portrait | דיוקן של כלב | Draw a dog's head, showing the fur through value rather than single hairs. | A |  | Own photo or Provided |
| CH-022 | A bird | ציפור | Draw a bird from simple shapes: head, body, tail. | I |  | Provided |
| CH-023 | A fish | דג | Draw a fish and the pattern of its scales. | B | ✓ | Provided |
| CH-024 | A horse in motion | סוס בתנועה | Draw a running or walking horse: gesture first. | A |  | Provided |
| CH-025 | Animals that move | בעלי חיים בתנועה | At a zoo, a farm or a park, draw small sketches of animals as they move. | I | ✓ | Life |
| **Architecture** | | | | | | |
| CH-026 | Your front door | דלת הכניסה שלך | Draw your front door with its frame and handle. | B | ✓ | Life |
| CH-027 | A room in one-point perspective | חדר בפרספקטיבה של נקודת מגוז אחת | Stand facing a wall and draw the room around it. | I |  | Life |
| CH-028 | A street corner | פינת רחוב | Draw a street corner with buildings going two ways. | A |  | Life or Own photo |
| CH-029 | A building from below | בניין מלמטה | Draw a tall building looking up at it. | A |  | Life or Own photo |
| **Landscapes** | | | | | | |
| CH-030 | Sky and clouds | שמיים ועננים | Draw today's clouds with soft edges and a few values. | B | ✓ | Life or Own photo |
| CH-031 | A landscape in three values | נוף בשלושה ערכים | Draw a landscape using only three values. | I |  | Own photo or Provided |
| CH-032 | Water | ים או אגם | Draw a sea or a lake, with the horizon and the reflections. | I |  | Own photo or Provided |
| CH-033 | A city skyline | קו רקיע של עיר | Draw a skyline as layered silhouettes, lighter with distance. | I |  | Own photo or Provided |
| **Portraits** | | | | | | |
| CH-034 | A family member | בן או בת משפחה | Draw someone from your family. Next time, someone else. | I |  | Life or Own photo |
| CH-035 | A self-portrait in the mirror | דיוקן עצמי במראה | Draw yourself in a mirror, measuring as you go. | I |  | Life |
| CH-036 | A profile | פרופיל | Draw a face in profile, starting from its silhouette. | I | ✓ | Life or Own photo |
| CH-037 | A face in three values | פנים בשלושה ערכים | Draw a face using only three values. | A |  | Own photo or Provided |
| CH-038 | An expression | פנים עם הבעה | Draw a face laughing, surprised or thoughtful, and how the features change. | A |  | Own photo or mirror |
| **Hands** | | | | | | |
| CH-039 | Your free hand | היד החופשית שלך | Draw your free hand in a new pose each time. | I | ✓ | Life |
| CH-040 | A hand holding something | יד אוחזת בחפץ | Draw a hand holding a cup, a pen or a phone. | A |  | Life |
| CH-041 | Two hands | שתי ידיים | Draw two hands together: clasped, gesturing, or at work. | A |  | Life or Own photo |
| **Hair** | | | | | | |
| CH-042 | A braid or ponytail | צמה או קוקו | Draw a braid or a ponytail as big masses and rhythm, not single hairs. | I |  | Life or Own photo |
| CH-043 | Curly hair | שיער מתולתל | Draw curly hair with values: big clumps first, a few curls last. | A |  | Own photo or Provided |
| **Figures** | | | | | | |
| CH-044 | Someone reading or resting | מישהו קורא או נח | Draw someone sitting still: gesture, then structure. | I |  | Life |
| CH-045 | People in a public place | אנשים במקום ציבורי | In a café or on a bus, draw small sketches of people. | I | ✓ | Life |
| CH-046 | A standing figure | דמות עומדת | Draw a standing figure, measured in head lengths. | I |  | Own photo or Provided |
| CH-047 | A figure in motion | דמות בתנועה | Draw a figure running, dancing or jumping. | A |  | Own photo or Provided |
| **Creative** | | | | | | |
| CH-048 | An imaginary creature | יצור דמיוני | Invent a creature from parts of real animals, built from simple forms. | I |  | Provided |
| CH-049 | A favourite place from memory | מקום אהוב מהזיכרון | Draw a place you love, from memory. | B | ✓ | Memory |
| CH-050 | A story in one picture | סיפור בתמונה אחת | Draw one moment that tells a story. | I |  | Memory or Own photo |

## 4. The nine screens

| Screen | Where | What it does | What it never does |
|---|---|---|---|
| **S1 Learn home** | `/app/learn`, from Home and the desktop navigation | Two choices: **Curriculum** (with "Continue: next exercise" for personal accounts) and **Challenges** (**Random**, **Quick**, **Browse**). The **Class mode** switch is in its header | Progress bars, streaks, badges |
| **S2 Curriculum** | `/app/learn/curriculum` | Core, Next steps and Colour, in the recommended order. Each exercise shows its title, a thumbnail, a "completed" tick with a count, and a lock when it is not in the plan | Force an order |
| **S3 Exercise card** | `/app/learn/exercises/<id>` | Title, a large reference (full screen and zoom) and the short instruction. **More help** holds the guide, the mistake and its fix, and the success criterion. Tool shortcuts open the tool with the reference already loaded. **Prepare Worksheets**, or **Print worksheet** for static sheets. **Mark as completed** is optional, with Undo | Timers, scores, uploads |
| **S4 Challenges** | `/app/learn/challenges` | Filters in one row: level, subject, pencil or colour, quick only; remembered on the device. **Random** skips the challenges completed most recently; **Quick** picks among the quick ones. Cards show a thumbnail, title, level, the quick mark, and a lock | Offer a locked challenge through Random or Quick |
| **S5 Challenge card** | `/app/learn/challenges/<id>` | Everything S3 has, plus **Another one** (same filters) and **Use my photo**, which opens S6 with a photo from the camera or files | Send the photo anywhere: it stays on the device |
| **S6 Prepare Worksheets** | A full-screen sheet over a card; also opened from Create a Grid and Study & Simplify | **Frame:** rotate 90° or 180°, zoom, move, Fit or Fill; A4, portrait or landscape. **Pages:** Original, Outline, Reference with grid, Blank grid, Values (3 or 5). **Grid:** columns × rows or square cells in cm, with edge labels. **Create PDF**, then Print, Share or Save. Every page has a 5 cm scale bar and "Print at 100%". The last choices are remembered on the device | Upload or keep the image |
| **S7 Class mode** | A switch in the Learn header | While it is on, Mark as completed is hidden, nothing is written to the account's history, and recent references stay only in this tab. It turns itself off after 12 idle hours | Student accounts, names or records |
| **S8 My history** | `/app/learn/history` | Completions, newest first (date and item); remove one with a tap. Included in the account's data download, and deleted with the account | Streaks, targets, penalties |
| **S9 Locked item** | In lists, and at the item's own address | In lists: the title, a lock, and a thumbnail only if previews are allowed. On its own page: the locked layout used by the tools ("part of Pro" or "not available"), **Back to Learn** and **Compare plans** | Send the instructions, the guide or the full-size reference |

## 5. Free/Pro administration (all in Admin → Plans)

**Today**, for each plan, Admin → Plans controls:

- the five tools, on or off;
- the image, GIF, large GIF and difference GIF saves, on or off, with
  optional daily or monthly quotas;
- any of these switched off for everyone except admins.

It has no Learn features, no PDF exports and no item level.

**Proposed new rows**, each with a Free switch and a Pro switch:

| Row | Controls | Quota |
|---|---|---|
| Drawing curriculum (`learn.curriculum`) | The 20 exercises as a whole | None |
| Colour module (`learn.color`) | The 7 colour exercises | None |
| Challenges (`learn.challenges`) | The 50 challenges as a whole | None |
| Grid PDF (`export.pdf`) | PDFs from Create a Grid | Optional, per day or month |
| Worksheet PDF (`export.worksheets`) | Prepare Worksheets packages | Optional, per day or month |

**Proposed Learn access section.** For each collection and plan there is one
rule:

- **All:** every published item, including items published later.
- **None:** no item.
- **Selected:** exactly the listed items. The list can be filled with **First
  N** (the first N items in the current order), **a whole group**, or by
  picking items.

Also in the section:

- one setting for what locked items show in lists: the title, or the title
  and a thumbnail;
- an "effective access" panel per plan;
- a diff that shows the items gained and lost;
- one draft and one publication together with the rest of the plans, with
  history and restore.

**First N, exactly:**

- It counts items, never units.
- It is resolved when chosen and frozen when published.
- Reordering or adding content never changes anyone's access.
- If the order changes, the editor says so and offers to apply the new
  order. Applying it is a new, reviewed publication.

**Order of decisions:**

1. An administrator sees everything.
2. Unpublished items are hidden from everyone else.
3. The account must be active.
4. The module must be on for the plan.
5. Then the plan's rule decides.
6. A worksheet made from a Learn reference also needs that item to be open.

**Examples:**

| Wish | Setting |
|---|---|
| Free gets the first 4 exercises, Pro everything | Curriculum on for both; Free: First 4; Pro: All |
| Free gets one challenge and nothing else in Learn | Challenges on for Free with Selected: CH-017; curriculum and colour off for Free |
| Worksheet PDFs for Pro only, 30 a month | Worksheet PDF: Pro on, with a quota of 30 per month; Free off |
| The Grid PDF for everyone, worksheets for Pro | Grid PDF on for both; Worksheet PDF on for Pro only |
| Show Free the curriculum locked, as a preview | Curriculum on for Free with None (or a short list); previews show the title and a thumbnail |
| Take Learn away from everyone at once | Switch the three modules off for everyone (admins keep access) |

**Suggested first values (your decision, at M9):**

- **Free:**
  - curriculum: First 4;
  - challenges: CH-002, CH-012 and CH-017;
  - colour: None.
- **Pro:** All.

## 6. Decisions that need your approval

**Now, before any work starts:**

| # | Decision | Recommendation |
|---|---|---|
| — | The rollback-safety fix as a separate change: implement, test, release to staging, report ([catalog-rollback-safety.md](../security/catalog-rollback-safety.md)) | Done: approved, then released to staging on 2026-11-18 (`224bb65`, ADR-0014) |
| A1 | This plan and its order, M1 to M9 (07) | Approve |
| A2 | The curriculum scope: 12 core exercises and 8 next steps | Approve; produce and publish the core first, and the next steps after the core has been used |
| A3 | The 50 challenges | Review the list above |
| A6 | Content lives in the database as versioned publications and is never committed. The repository is public (checked 2026-11-18), so the drafts in these documents are already readable by anyone | Approve |
| A8 | Entitlements: everything in Admin → Plans; All, None or Selected per collection and plan; First N frozen when published; the dark launch | Approve |
| A19 | Reference images: files on the server outside the releases and `public/`, named by hash; metadata in MongoDB; access checked on every request; an incremental copy with the nightly backup | Approve |

**Later, before the milestone that needs them** (details in 07):

| # | Decision | Recommendation | Before |
|---|---|---|---|
| A4 | Where Learn lives | Built in M5 as recommended: Home and desktop navigation; on phones through Home (ADR-0018) | M5 |
| A5 | The PDF library | Decided in M2: jsPDF 4.2.1, loaded on demand (ADR-0015) | M2 |
| A7 | Image sources | Own or commissioned, plus CC0 museum collections; model releases | M4 |
| A9 | What locked items show | Built in M5 as the catalog setting in Admin → Plans (titles, or titles and thumbnails); your choice for launch | M5 |
| A10 | Class mode | Built in M5 as recommended: "Class mode", per browser tab, off after 12 hours without use | M5 |
| A11 | Grid scope | Rotation, A4, square cells and a blank grid now; fine rotation later | M1 |
| A12 | Moving the Values algorithm | Done in M3, unchanged, with golden tests (ADR-0016) | M3 |
| A13 | Analytics | None (M5) | M5 |
| A14 | Who reviews the content and the Hebrew | You name the reviewers | M7 |
| A15 | Real-staging tests at every milestone | Approve as standing practice | M1 |
| A16 | Measuring drawing accuracy | Not in v1 (M5 measures nothing) | M5 |
| A17 | Paper and Hebrew text in PDFs | Decided in M2: A4 only; words as images (ADR-0015) | M2 |
| A18 | Claims about results | None before an evaluation exists | M9 |

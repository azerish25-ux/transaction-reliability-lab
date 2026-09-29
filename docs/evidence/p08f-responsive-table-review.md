# P08F responsive table inspection and regression

This is agent-driven inspection of real browser evidence, not human usability or screen-reader testing. Overall product remains INCOMPLETE / NO_GO.

Corrected source `70a94d46cede9f6c7ed835eb64379636378d415f` passed all thirty administrator journeys in focused run `36506926730`. The publisher workflow's head was `04eafed7a75a47c308778d152a8890ce4607748a`; its preserved source-sha.txt and source bundle identify the actual checked-out-and-tested implementation separately. Artifact `11008040092` was downloaded and matched SHA-256 `4f65881daf83542cebd5114b9aa6b2d393ec6fa27b7b39b350bc7485d3da65bc`. Generated XML confirmed thirty tests, zero failures/errors/skips. This focused run is not the full required P08F gate.

All fifteen original administrator screenshots from that run were inspected, including native-width mobile detail crops. Navigation and filter labels were corrected, but the inherited customer-wallet mobile table-to-card transformation still hid column headings and placed unrelated investigation fields in unlabeled columns. Automated axe and document-overflow checks alone did not detect that presentation problem.

The correction explicitly preserves semantic table/header/row/cell layout inside administrator tables, retains visible column headings at every width, and uses the existing labeled, keyboard-focusable horizontal-scroll region on narrow screens. The original customer account/card CSS is unchanged. `P08FLAYOUT01` runs against real protected transaction data in all three existing browser projects and checks computed table/header/cell display, actual heading dimensions, visible column headings, focus, keyboard horizontal scrolling where needed, axe and document width. Its execution is mapped to P08F06/P08F07.

A fresh full permanent run and its final responsive screenshots must verify this source before P08F is promoted. The thirty original administrator journeys, earlier financial/browser campaign and exact-source evidence requirements remain intact.

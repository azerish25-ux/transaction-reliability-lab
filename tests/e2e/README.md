# Browser and accessibility suite

The executable P08A Chromium journeys live at `frontend/tests/e2e/p08a.spec.ts` so they resolve the locked frontend Playwright and axe dependencies without a duplicate package installation. `frontend/playwright.config.ts` runs the same real Compose-backed journeys at 1440×900, 768×1024 and 390×844, retaining JUnit, screenshots, traces and failure recordings under `.evidence/playwright/`.

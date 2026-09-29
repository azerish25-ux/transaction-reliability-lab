import { test, expect, signIn, accessible } from './p08c-fixtures.js';

// Use real protected records; keep automatic recordings off for administrator data.
test.use({ trace: 'off', video: 'off', screenshot: 'off', actionTimeout: 10_000, navigationTimeout: 20_000 });
test.setTimeout(60_000);

test('P08FLAYOUT01 administrator tables retain headings and keyboard scrolling', async ({ page, lab }) => {
  const fixture = await lab.settled();
  const admin = await lab.actor(true);
  await signIn(page, admin);
  await page.goto(`/admin/transactions?reference=${fixture.payment.id}`);
  const region = page.getByRole('region', { name: 'Transaction search results', exact: true });
  const table = region.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('columnheader')).toHaveCount(5);
  await expect(table.getByRole('columnheader', { name: 'Operation', exact: true })).toBeVisible();
  const layout = await table.evaluate(element => {
    const head = element.querySelector('thead');
    const cell = element.querySelector('tbody td');
    if (!head || !cell) throw new Error('Expected actual investigation table headings and data');
    return {
      table: getComputedStyle(element).display,
      head: getComputedStyle(head).display,
      cell: getComputedStyle(cell).display,
      headingHeight: head.getBoundingClientRect().height,
      headingWidth: head.getBoundingClientRect().width
    };
  });
  expect(layout.table).toBe('table');
  expect(layout.head).toBe('table-header-group');
  expect(layout.cell).toBe('table-cell');
  expect(layout.headingHeight).toBeGreaterThan(20);
  expect(layout.headingWidth).toBeGreaterThan(100);
  await region.focus();
  await expect(region).toBeFocused();
  const scrollable = await region.evaluate(element => element.scrollWidth > element.clientWidth);
  if ((page.viewportSize()?.width ?? 0) < 540) expect(scrollable).toBe(true);
  if (scrollable) {
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  }
  await accessible(page);
});

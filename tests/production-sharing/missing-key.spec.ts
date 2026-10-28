import { test, expect, openLocalComparison, openShare, publishButton } from './fixtures';

test('requires a configured frontend site key before loading verification or allowing publication', async ({
  page,
  sharing,
}) => {
  await openLocalComparison(page);
  await openShare(page);
  await page.getByRole('checkbox').check();
  await expect(page.getByRole('dialog')).toContainText('configure verification before publishing');
  await expect(publishButton(page)).toBeDisabled();
  expect(sharing.scriptRequests).toBe(0);
  expect(sharing.verification.requests).toHaveLength(0);
  await sharing.empty();
});

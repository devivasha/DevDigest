import { test, expect } from 'playwright'

test('loads home', async ({ page }) => {
  await page.goto('http://localhost:3000')
  await expect(page).toHaveTitle(/DevDigest/)
})

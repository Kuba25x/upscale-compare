// Planning scenarios only. No provider meter, admission policy or live setting.
export function browserBudget(
  localColdSeconds,
  { publicationsPerDay = 5, slowdown = 1, failedAttempts = 1, uncertainClosures = 1 } = {},
) {
  if (
    !Number.isFinite(localColdSeconds) ||
    localColdSeconds < 0 ||
    !Number.isInteger(publicationsPerDay) ||
    publicationsPerDay < 1
  )
    throw new Error('Invalid planning inputs.');
  const successfulSessionSeconds = publicationsPerDay * localColdSeconds * slowdown;
  const failureDeadlineSeconds = failedAttempts * 30;
  const idleTailSeconds = uncertainClosures * 60;
  const modeledSeconds = successfulSessionSeconds + failureDeadlineSeconds + idleTailSeconds;
  return {
    publicationsPerDay,
    localColdSeconds,
    slowdown,
    failedAttempts,
    uncertainClosures,
    successfulSessionSeconds,
    failureDeadlineSeconds,
    idleTailSeconds,
    modeledSeconds,
    publishedFreeSecondsPerDay: 600,
    researchWorkingBudgetSeconds: 300,
    belowWorkingBudget: modeledSeconds <= 300,
    belowPublishedAllowance: modeledSeconds <= 600,
    providerConsumptionMeasured: false,
    cloudflareFreeCertified: false,
  };
}

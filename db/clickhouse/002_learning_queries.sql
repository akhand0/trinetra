-- Inspect learned policies by context.
SELECT
  context_bucket,
  arm,
  reward_sum,
  trials,
  1 + reward_sum AS alpha,
  1 + trials - reward_sum AS beta,
  alpha / (alpha + beta) AS posterior_mean
FROM posterior_by_context
ORDER BY context_bucket, posterior_mean DESC;

-- Inverse-propensity-weighted estimate for off-policy evaluation.
SELECT
  context_bucket,
  arm,
  count() AS events,
  avg(value) AS observed_reward,
  avg(value / greatest(propensity, 0.01)) AS ips_reward
FROM reward_events
WHERE event_type != 'impression'
GROUP BY context_bucket, arm
ORDER BY context_bucket, ips_reward DESC;

-- Learning curve used by the dashboard.
SELECT
  toDate(ts) AS day,
  avg(value) AS average_reward,
  countIf(event_type = 'confirm_root_cause') AS confirmed_roots,
  count() AS reward_events
FROM reward_events
GROUP BY day
ORDER BY day;

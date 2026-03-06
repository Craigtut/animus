module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Don't restrict scopes (allow any project-specific scope)
    'scope-enum': [0],
    // Keep subject under 100 chars (relaxed from default 72 for descriptive messages)
    'header-max-length': [2, 'always', 100],
  },
};

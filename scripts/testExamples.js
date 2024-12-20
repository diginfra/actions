#!/usr/bin/env node
const { spawn } = require('child_process');
const fs = require('fs');
require('dotenv').config()

const args = process.argv.slice(2);
const update = args.length > 0 && args[0] === 'true';

let command = `act \
--container-architecture linux/amd64 \
-W .github/workflows/examples_test.yml \
-s GITHUB_TOKEN=$GITHUB_TOKEN \
-s GIT_SSH_KEY="$GIT_SSH_KEY" \
-s DIGINFRA_API_KEY=$(diginfra configure get api_key) \
-s TFC_TOKEN=$TFC_TOKEN \
-s EXAMPLE_DEV_AWS_ACCESS_KEY_ID=mock_access_key \
-s EXAMPLE_DEV_AWS_SECRET_ACCESS_KEY=mock_secret_key \
-s EXAMPLE_PROD_AWS_ACCESS_KEY_ID=mock_access_key \
-s EXAMPLE_PROD_AWS_SECRET_ACCESS_KEY=mock_secret_key \
--artifact-server-path=.act/artifacts`;

if (update) {
  command += ` --env UPDATE_GOLDEN_FILES=true -b`;
}

console.log(`Running ${command}`);

const child = spawn('bash', ['-c', command], { env: process.env });

child.stdout.on('data', (data) => {
  process.stdout.write(data.toString());
});

child.stderr.on('data', (data) => {
  process.stderr.write(data.toString());
});

child.on('exit', () => {
  // Cleanup
  if (update) {
    for (const dir of ['.ssh', 'workflow']) {
      try {
        console.log(`Cleaning up: ${dir}`)
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true });
        }
      } catch (err) {
        console.error(`Error while deleting ${dir}: ${err}`);
      }
    }
  }
});

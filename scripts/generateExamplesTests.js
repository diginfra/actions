#!/usr/bin/env node

// This file generates a GitHub action to test the examples by extracting the
// examples from each README file, modifying them slightly and then writing
// them to a GitHub action.

const fs = require('fs');
const yaml = require('js-yaml');
const {env} = require('process');

const examplesTestWorkflowPath = './.github/workflows/examples_test.yml';
const examplesDir = 'testdata/tests';

const localSkipJobs = [
  // These jobs are skipped locally until https://github.com/nektos/act/issues/769 is fixed
  'multi-project-matrix',
  'multi-project-matrix-merge',
  'multi-workspace-matrix',
  'multi-workspace-matrix-merge',
]

const workflowTemplate = {
  name: 'Run examples',
  on: {
    push: {
      branches: ['master'],
    },
    pull_request: {},
  },

  defaults: {
    run: {
      shell: 'bash',
    },
  },

  jobs: {},
};

// Extracts all the examples from a directory
function extractAllExamples(examplesDir) {
  const examples = [];

  for (const file of fs.readdirSync(examplesDir)) {
    const fp = `${examplesDir}/${file}`;
    if (!fs.statSync(fp).isFile()) {
      continue;
    }

    const content = fs.readFileSync(fp, 'utf8');
    const y = yaml.load(content);
    examples.push(y);
  }

  return examples;
}

// Modifies the examples by:
// 1. Replacing any diginfra/actions steps with the local path
// 2. Replacing the diginfra/actions/comment step with a step that comment contents
function fixupExamples(examples) {
  for (const example of examples) {
    for (const jobEntry of Object.entries(example.jobs)) {
      const [jobKey, job] = jobEntry;

      const steps = [];
      for (let i = 0; i < job.steps.length; i++) {
        const step = job.steps[i];

        if (step.name && step.name.toLowerCase() === 'checkout base branch') {
          // In the tests we don't actually want to use the base branch since we might have updated
          // the actual tests themselves.
          if (step.with) {
            delete step.with.ref;
          }

          steps.push(step);

          continue;
        }

        if (step.name && step.name.toLowerCase() === 'generate diginfra diff') {
          steps.push(
            {
              name: 'Replace m5 instance',
              run: `find testdata/code -type f  -name '*.tf' -o -name '*.hcl' -o -name '*.tfvars'  | xargs sed -i 's/m5\.4xlarge/m5\.8xlarge/g'`
            },
            {
              name: 'Replace t2 instance',
              run: `find testdata/code -type f  -name '*.tf' -o -name '*.hcl' -o -name '*.tfvars'  | xargs sed -i 's/t2\.micro/t2\.medium/g'`
            },
            step,
          )

          continue;
        }

        if (step.name && step.name.toLowerCase() === 'post diginfra comment') {
          const goldenFilePath = `./testdata/results/${jobKey}_comment_golden.md`;

          const commentArgs = step.run
            .replace(/\\/g, '')
            .replace(/--pull-request=\$\{\{ github\.event\.pull_request\.number \}\}/g, '--pull-request=1')
            .split('\n')
            .map(s => s.trim())
            .filter(e => !e.startsWith('#') && e !== '')

          commentArgs.push('--dry-run true', '> /tmp/diginfra_comment.md')
          step.run = commentArgs.join(' \\\n');

          steps.push(
            step,
            {
              run: `diff -y ${goldenFilePath} /tmp/diginfra_comment.md`,
              name: 'Check the comment',
              if: `env.UPDATE_GOLDEN_FILES != 'true'`,
            },
            {
              name: 'Update the golden comment file',
              run: `cp /tmp/diginfra_comment.md ${goldenFilePath}`,
              if: `env.UPDATE_GOLDEN_FILES == 'true'`,
            }
          );

          continue;
        }

        if (step.uses && step.uses.startsWith('slackapi/slack-github-action')) {
          // Assume this path for now. If we add our own Slack action we can get this easier from an input
          const path = '/tmp/diginfra.json';
          const goldenFilePath = `./testdata/${jobKey}_slack_message_golden.json`;

          steps.push(
            {
              name: 'Generate Slack message',
              run: `diginfra output --path=${path} --format=slack-message --show-skipped --out-file=/tmp/diginfra_slack_message.json`,
            },
            {
              name: 'Check the Slack message',
              run: `diff -y <(jq --sort-keys . ${goldenFilePath}) <(jq --sort-keys . /tmp/diginfra_slack_message.json)`,
              if: `env.UPDATE_GOLDEN_FILES != 'true'`,
            },
            {
              name: 'Update the golden Slack message file',
              run: `jq --sort-keys . /tmp/diginfra_slack_message.json > ${goldenFilePath}`,
              if: `env.UPDATE_GOLDEN_FILES == 'true'`,
            }
          );

          continue;
        }

        // Since we're using the local action we need to make sure the we have the code checked out before running that action
        // We should only do this if the setup action is the first step
        if (i == 0 && step.uses && step.uses.startsWith('diginfra/actions/setup')) {
          steps.push(
            {
              name: 'Checkout source code so we can install the action locally',
              uses: 'actions/checkout@v3',
            },
          );
        }

        // Replace diginfra/actions steps with the local path
        steps.push({
          ...step,
          uses:
            step.uses &&
            step.uses.replace(/diginfra\/actions\/(\w+)(@\w+)?/, './$1'),
        });
      }

      job.steps = steps;

      if (localSkipJobs.includes(jobKey)) {
        job.if = 'github.actor != \'nektos/act\'';
      }
    }
  }

  return examples;
}

// Generate the workflow YAML from the examples
function generateWorkflow(examples) {
  const workflow = {...workflowTemplate};

  for (const example of examples) {
    workflow.jobs = {
      ...workflow.jobs,
      ...example.jobs,
    };
  }

  return workflow;
}

// Write the generated workflow to a file
function writeWorkflow(workflow, target) {
  try {
    fs.writeFileSync(target, yaml.dump(workflow));
  } catch (err) {
    console.error(`Error writing YAML file: ${err}`);
  }
}

let examples = extractAllExamples(examplesDir);
examples = fixupExamples(examples);
const workflow = generateWorkflow(examples);
writeWorkflow(workflow, examplesTestWorkflowPath);

console.log('DONE');

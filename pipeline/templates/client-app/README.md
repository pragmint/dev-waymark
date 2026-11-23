# Waymark pipeline for one client

This repo runs the [Waymark pipeline](https://github.com/pragmint/dev-waymark/tree/main/pipeline)
for one client on GitHub Actions. It runs an incremental extract every hour and a full extract
every Sunday. Each run extracts, builds the registry's active jobs, verifies them, and publishes a
new snapshot. Tables that haven't changed are reused.

It holds the client's config and the client's own jobs. The pipeline code comes from
`pragmint/dev-waymark` at the commit in `.waymark-ref`. The shared jobs come from the shared job
registry, and this repo's jobs go into the client's registry through pull requests.

The template is kept in `pipeline/templates/client-app/` of `pragmint/dev-waymark` and copied to
`pragmint/dev-waymark-client-template` from there, so change it there. A repo made from it doesn't
follow later changes to the template.

```
clients/<client>.toml                   sources and mappings
jobs/<job>/                             the client's own jobs (a lead time example)
.waymark-ref                            the pipeline commit this client runs
.github/workflows/pipeline.yml          the schedule and the run
.github/workflows/jobs.yml              previews a changed job on a PR, promotes it on merge
.github/actions/setup-pipeline/         the setup both workflows share
```

## Set up

1. **Create the repo from the template.** On
   [pragmint/dev-waymark-client-template](https://github.com/pragmint/dev-waymark-client-template),
   choose **Use this template → Create a new repository**, and make it **private**. Scheduled
   workflows only run on the default branch, and GitHub turns them off in public repos after 60
   days without activity. The workflows stay off in the template repo itself.
2. **Write the client config.** Rename `clients/example.toml` to `clients/<client>.toml` and fill
   it in. The keys are described in the pipeline README, under "Client config".
3. **Pin the pipeline.** Put a full commit SHA on `main` of `pragmint/dev-waymark` in
   `.waymark-ref`.
4. **Set the repo variables** (Settings → Secrets and variables → Actions → Variables):

   | Variable           | Value                                                                     |
   | ------------------ | ------------------------------------------------------------------------- |
   | `CLIENT`           | The client's name, the same as the TOML file name and its `client`.       |
   | `BUCKET_URL`       | The client's root, such as `s3://waymark/clients/<client>`.               |
   | `SHARED_URL`       | The shared job registry, such as `s3://waymark/shared`.                   |
   | `AWS_REGION`       | The bucket's region. `auto` for Cloudflare R2.                            |
   | `AWS_ROLE_ARN`     | AWS only: the role the workflow assumes (step 6).                         |
   | `AWS_ENDPOINT_URL` | R2 or MinIO only: `https://<account id>.r2.cloudflarestorage.com` for R2. |

5. **Set the repo secrets:**

   | Secret                                       | Value                                                                                                                                                                                       |
   | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `SOURCE_GITHUB_TOKEN`                        | A token that can read pull requests on every repo in `github.repos`. Not the workflow's own token: it only reaches this repo and allows 1,000 requests an hour. A GitHub App token is best. |
   | `JIRA_EMAIL`, `JIRA_API_TOKEN`               | Jira Cloud only. On Jira Server the token is optional.                                                                                                                                      |
   | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Without `AWS_ROLE_ARN` only (step 6).                                                                                                                                                       |

   `pragmint/dev-waymark` is public, so checking it out needs no token. If it ever goes private,
   add a fine-grained token with read-only Contents on it as a secret, and pass it as `token:` to
   the step that checks it out.

6. **Let the workflow into the bucket.** Whichever way, give it read and write on the client's
   root and read on the shared registry, nothing more: SQL jobs run with these credentials.
   - **AWS:** add GitHub as an OIDC identity provider in the AWS account, and create a role whose
     trust policy allows `repo:<org>/<this repo>:ref:refs/heads/main` and, for job previews,
     `repo:<org>/<this repo>:pull_request`. Set `AWS_ROLE_ARN`. No keys are stored. A preview
     writes a snapshot that's never published, so pull requests need the same write access as
     `main`; that's one reason this repo must be private.
   - **Cloudflare R2 or MinIO** (no OIDC): create an API token with object read and write on the
     bucket, and store its key pair as the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
     secrets. Leave `AWS_ROLE_ARN` unset and set `AWS_ENDPOINT_URL`. R2 tokens are scoped to
     buckets, not prefixes, so give each client its own bucket if they mustn't see each other.
7. **Seed the shared registry**, once for every client. This repo's workflows can only read it.
   From a checkout of `pragmint/dev-waymark`, in `pipeline/`, with credentials that can write it:

   ```sh
   uv run python registry.py --bucket-url "$SHARED_URL" push --activate jobs
   ```

8. **Run the first full extract.** In the Actions tab, run the **pipeline** workflow by hand with
   `extract: full`. Incremental runs build on the last full run, so wait until this one publishes
   before relying on the schedule.
9. **Promote the client's jobs.** Run the **jobs** workflow by hand with `job: all`. A promote
   previews against the last extract, so it can't run before step 8 finishes. The next hourly run
   publishes them. Skip this if `jobs/` is empty.

## Running it

- **Changing one of this client's jobs:** open a pull request against `jobs/`. See
  [jobs/README.md](jobs/README.md). If the promote fails after a merge, the job's old version
  stays active: fix it in another PR, or rerun the workflow if the failure wasn't the job's.
- **Changing a shared job:** that happens in `pragmint/dev-waymark`, with `orchestrate.py promote
--shared` (pipeline README, "Job registry"). You don't need to change this repo.
- **Upgrading the pipeline:** bump `.waymark-ref`.
- **A run failed with the extract lock held:** a run that was killed, for example by the 50-minute
  timeout, leaves `runs/extract.lock` behind, and every later run fails until it's removed. Run
  the workflow by hand with `break_lock` ticked. Runs never overlap, so a held lock is always
  stale.
- **Missed runs:** GitHub can start a scheduled run late or skip it when it's busy. The next
  incremental run picks up whatever was missed.
- **Failure emails:** GitHub emails failed scheduled runs to the person who last changed the
  `cron` lines. Add a Slack or email step if someone else should hear about them.
- **Container jobs:** each job's image must be pullable by the runner. If it's in a private
  registry, add a `docker login` step before the run.

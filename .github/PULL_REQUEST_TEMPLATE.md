## Purpose

<!-- Place this pull request in a larger narrative complete with links to any relevant threads and issues. What prompted these changes? What do we hope to achieve? Is this a small bug fix, or part of a larger initiative? -->

NA

## Omissions

<!-- Acknowledge limitations of this change and why addressing them is out of scope. -->

NA

## Effects

<!-- Document how these changes impact behavior. This can take the form of images, sample output, or documentation for using a new feature. -->

NA

## Technicals (Tradeoffs, tech debt, and techniques)

<!-- Anything surprising, confusing, novel, or concerning about this change should be captured here. Ideally, reviewers will be prepared to understand why all the pieces of this change are necessary. This is also a good place to teach reviewers about the APIs being used or ask reviewers for technical help -->

NA

## Validation

<!-- Before merging, this section should be updated to summarize how we know that this change has the effects it intends to.  -->

TBD

## Checklist for topics frequently missed in review

- [ ] I've thought about whether and where this feature should be documented. Docs are represented somewhere in these changes or in an existing issue
- [ ] I've reviewed the yarn.lock file's diff to ensure we're avoiding pulling in new packages or new versions of existing packages where possible
- [ ] This change either doesn't use any fs apis or all fs api usage is concurrency-safe

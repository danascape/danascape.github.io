#!/bin/bash
cd /public
git remote rm origin
git remote add origin https://danascape:${GH_PERSONAL_TOKEN}@github.com/danascape/danascape.github.io

echo -e "\033[0;32mDeploying updates to GitHub...\033[0m"
cd /app
hugo -d /public

# Go To Public folder
cd /public

# Add changes to git.
git add .

# Commit changes.
git commit -m "[CI]: Push Built Site" -s

# Push source and build repos.
git push origin master

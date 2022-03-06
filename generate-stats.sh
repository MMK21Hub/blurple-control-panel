#!/bin/sh
echo "File sizes:"
for i in $(git rev-list master); do
  git cat-file $i:index.ts -s
done

echo
echo "Line counts:"
for i in $(git rev-list master); do
  git cat-file $i:index.ts -p | wc -l
done

echo
echo "Commit messages:"
for i in $(git rev-list master); do
  git --no-pager log -n 1 --pretty=format:%s $i
  echo
done
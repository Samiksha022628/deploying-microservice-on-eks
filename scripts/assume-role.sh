ROLE_ARN="arn:aws:iam::874616579683:role/MyStackCreatedRole"
SESSION_NAME="GitHubActionSession"

creds=$(aws sts assume-role \
  --role-arn "$ROLE_ARN" \
  --role-session-name "$SESSION_NAME" \
  --output json)

ACCESS_KEY=$(echo "$creds" | jq -r '.Credentials.AccessKeyId')
SECRET_KEY=$(echo "$creds" | jq -r '.Credentials.SecretAccessKey')
SESSION_TOKEN=$(echo "$creds" | jq -r '.Credentials.SessionToken')

echo "AWS_ACCESS_KEY_ID=$ACCESS_KEY" >> $GITHUB_ENV
echo "AWS_SECRET_ACCESS_KEY=$SECRET_KEY" >> $GITHUB_ENV
echo "AWS_SESSION_TOKEN=$SESSION_TOKEN" >> $GITHUB_ENV
echo "Assumed role: $ROLE_ARN"

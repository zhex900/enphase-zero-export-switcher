Setup

1. Install deps in this directory

```
npm i
```

2. Select stack (e.g. tesla-api) and set config

```
pulumi stack select tesla-api --create
pulumi config set TESLA_ALLOWED_USERS "you@example.com"
pulumi config set TESLA_CLIENT_ID "..."
pulumi config set --secret TESLA_CLIENT_SECRET "..."
```

3. Deploy (build runs automatically)

```
npm run up
```

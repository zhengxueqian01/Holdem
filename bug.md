# bug
我复制了.env.sample为.env后，需要修改localhost为本机ip，然后发现无法读取

1.apps/server/src/index.ts的41行，这里读不到env里的
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  需要把localhost改成部署地址的ip，下同

2.apps/web/src/App.tsx的第107行，这里读不到env里的VITE_API_URL
  const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";


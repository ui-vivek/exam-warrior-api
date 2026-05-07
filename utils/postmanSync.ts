import fs from 'fs';
import path from 'path';

import listEndpoints from 'express-list-endpoints';

export function syncPostman(app: any) {
  // In Express 5, the routes are in app.router
  const router = app.router || app._router || app;
  const endpoints = listEndpoints(router);

  console.log(`[POSTMAN] Found ${endpoints.length} endpoints`);
  const projectRoot = process.cwd();
  
  const collection = {
    info: {
      name: "Exam Warrior Auto-Sync",
      description: "Automatically generated collection from Express routes",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item: endpoints
      .filter(ep => ep.path !== '*' && ep.path !== '/health') // Filter out noise
      .map(ep => {
        return {
          name: `${ep.methods.join(',')} ${ep.path}`,
          request: {
            method: ep.methods[0],
            header: [
              {
                key: "Authorization",
                value: "Bearer {{access_token}}",
                type: "text"
              }
            ],
            body: ep.methods[0] !== 'GET' ? {
              mode: "raw",
              raw: "{\n    \n}",
              options: { raw: { language: "json" } }
            } : undefined,
            url: {
              raw: `{{base_url}}${ep.path}`,
              host: ["{{base_url}}"],
              path: ep.path.split('/').filter(p => p)
            }
          },
          response: []
        };
      }),
    variable: [
      { key: "base_url", value: "http://localhost:5050", type: "string" },
      { key: "access_token", value: "", type: "string" }
    ]
  };

  const filePath = path.join(projectRoot, 'ExamWarrior.postman_collection.json');
  fs.writeFileSync(filePath, JSON.stringify(collection, null, 2));
}

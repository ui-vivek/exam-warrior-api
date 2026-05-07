import fs from 'fs';
import path from 'path';
import listEndpoints from 'express-list-endpoints';
import { Express } from 'express';

export function syncPostman(app: Express) {
  const endpoints = listEndpoints(app);
  const projectRoot = process.cwd();
  
  const collection = {
    info: {
      name: "Exam Warrior Auto-Sync",
      description: "Automatically generated collection from Express routes",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item: endpoints.map(ep => {
      // Group by first part of path (e.g., /auth, /users)
      const parts = ep.path.split('/').filter(p => p && p !== 'api' && p !== 'v1');
      const folder = parts[0] || 'General';
      
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
  console.log(`[POSTMAN] Collection updated at ${filePath}`);
}

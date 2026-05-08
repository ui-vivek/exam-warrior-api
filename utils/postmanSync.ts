import fs from 'fs';
import path from 'path';
import listEndpoints from 'express-list-endpoints';

export function syncPostman(app: any) {
  const router = app.router || app._router || app;
  const endpoints = listEndpoints(router);
  const projectRoot = process.cwd();

  const getDummyPayload = (fullPath: string, method: string) => {
    if (method === 'GET') return undefined;

    // Use normalized path for matching
    const p = fullPath.toLowerCase();

    if (p.includes('send-otp')) {
      return { phone: "+919999999999" };
    }
    if (p.includes('verify-otp')) {
      return { phone: "+919999999999", otp: "123456" };
    }
    if (p.includes('refresh-token')) {
      return { refreshToken: "your_refresh_token_here" };
    }
    if (p.includes('exam-type')) {
      return { examType: "SSC" };
    }
    if (p.includes('/submit')) {
      return {
        answers: [
          { questionId: "65f123456789abcdef012345", selectedOption: "a", timeSpentSec: 15 },
          { questionId: "65f123456789abcdef012346", selectedOption: "c", timeSpentSec: 10 }
        ],
        timeTakenSec: 120
      };
    }
    if (p.includes('/report')) {
        return { reason: "Question is wrong", details: "The correct answer should be B." };
    }
    if (p.includes('generate-questions')) {
        return { count: 20, examType: "SSC" };
    }
    return {};
  };

  const getFolderName = (fullPath: string) => {
    const parts = fullPath.split('/').filter(p => p && p !== 'api' && p !== 'v1');
    if (parts.length === 0) return 'General';
    
    const root = parts[0].toLowerCase();
    if (root === 'auth') return 'Authentication';
    if (root === 'users') return 'User Profile';
    if (root === 'tests') return 'Tests & Exams';
    if (root === 'questions') return 'Questions Management';
    
    return root.charAt(0).toUpperCase() + root.slice(1);
  };

  const folders: { [key: string]: any[] } = {};

  endpoints
    .filter(ep => ep.path !== '*' && ep.path !== '/health')
    .forEach(ep => {
      const folder = getFolderName(ep.path);
      if (!folders[folder]) folders[folder] = [];

      const displayPath = ep.path.replace('/api/v1', '');
      const payload = getDummyPayload(ep.path, ep.methods[0]);
      
      folders[folder].push({
        name: `${ep.methods.join(',')} ${displayPath}`,
        request: {
          method: ep.methods[0],
          header: [
            {
              key: "Authorization",
              value: "Bearer {{access_token}}",
              type: "text"
            }
          ],
          body: payload ? {
            mode: "raw",
            raw: JSON.stringify(payload, null, 4),
            options: { raw: { language: "json" } }
          } : undefined,
          url: {
            raw: `{{base_url}}${displayPath}`,
            host: ["{{base_url}}"],
            path: displayPath.split('/').filter(p => p)
          }
        },
        response: []
      });
    });

  const collection = {
    info: {
      name: "Exam Warrior API",
      description: "Comprehensive API collection for Exam Warrior Backend (Auto-Synced)",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item: Object.keys(folders).sort().map(name => ({
      name,
      item: folders[name]
    })),
    variable: [
      { key: "base_url", value: "http://localhost:5050/api/v1", type: "string" },
      { key: "access_token", value: "your_jwt_token_here", type: "string" }
    ]
  };

  const filePath = path.join(projectRoot, 'ExamWarrior.postman_collection.json');
  fs.writeFileSync(filePath, JSON.stringify(collection, null, 2));
  console.log(`[POSTMAN] Collection synced with ${endpoints.length} routes.`);
}

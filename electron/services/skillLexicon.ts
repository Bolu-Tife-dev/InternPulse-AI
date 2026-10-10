// Canonical tech lexicon used for resume parsing and job tech-tag normalisation.

export const SKILL_LEXICON: string[] = [
  // languages
  'javascript', 'typescript', 'python', 'java', 'c#', 'c++', 'go', 'golang', 'rust', 'ruby', 'php',
  'kotlin', 'swift', 'dart', 'scala', 'elixir', 'haskell', 'r', 'sql', 'html', 'css', 'scss', 'sass',
  'bash', 'powershell', 'solidity', 'matlab', 'perl', 'objective-c',
  // frontend
  'react', 'react.js', 'reactjs', 'next.js', 'nextjs', 'vue', 'vue.js', 'vuejs', 'nuxt', 'angular',
  'svelte', 'sveltekit', 'redux', 'zustand', 'recoil', 'rxjs', 'tailwind', 'tailwind css',
  'bootstrap', 'material ui', 'mui', 'chakra ui', 'antd', 'styled-components', 'sass', 'webpack',
  'vite', 'rollup', 'esbuild', 'parcel', 'storybook', 'jest', 'vitest', 'cypress', 'playwright',
  'selenium', 'testing library', 'pwa', 'webgl', 'three.js', 'd3', 'graphql', 'rest', 'rest api',
  'soap', 'websocket', 'webrtc', 'seo', 'accessibility', 'wcag', 'responsive design', 'html5', 'css3',
  // backend
  'node.js', 'nodejs', 'express', 'express.js', 'nestjs', 'koa', 'fastify', 'django', 'flask',
  'fastapi', 'spring', 'spring boot', 'laravel', 'rails', 'ruby on rails', 'asp.net', '.net',
  'dotnet', 'graphql', 'apollo', 'trpc', 'grpc', 'rabbitmq', 'kafka', 'redis', 'mongodb', 'mongoose',
  'postgresql', 'postgres', 'mysql', 'sqlite', 'mariadb', 'oracle', ' dynamodb', 'elasticsearch',
  'firebase', 'supabase', 'prisma', 'typeorm', 'sequelize', 'sqlalchemy', 'hibernate', 'mongoose',
  'socket.io', 'websocket', 'microservices', 'serverless', 'aws lambda', 'cloud functions',
  // devops / cloud
  'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'jenkins', 'github actions', 'ci/cd',
  'cicd', 'gitlab ci', 'circleci', 'aws', 'azure', 'gcp', 'google cloud', 'heroku', 'vercel',
  'netlify', 'digitalocean', 'linux', 'ubuntu', 'debian', 'centos', 'nginx', 'apache', 'grafana',
  'prometheus', 'datadog', 'sentry', 'helm', 'argocd', 'istio', 'pulumi', 'cloudflare',
  // mobile / other
  'react native', 'flutter', 'ionic', 'expo', 'android', 'ios', 'swiftui', 'jetpack compose',
  'electron', 'tauri', 'qt', 'unity', 'unreal', 'ar/vr', 'machine learning', 'ml', 'ai', 'llm',
  'openai', 'langchain', 'pytorch', 'tensorflow', 'pandas', 'numpy', 'scikit-learn', 'nlp',
  'computer vision', 'data engineering', 'airflow', 'spark', 'hadoop', 'etl', 'data modeling',
  // practices
  'agile', 'scrum', 'kanban', 'jira', 'confluence', 'git', 'github', 'gitlab', 'bitbucket',
  'svn', 'tdd', 'bdd', 'unit testing', 'integration testing', 'code review', 'pair programming',
  'domain driven design', 'solid', 'clean architecture', 'microservices', 'oauth', 'jwt', 'sso',
  'security', 'penetration testing', 'websockets', 'web3', 'blockchain', 'solidity', 'ethers.js',
  'web3.js', 'strapi', 'sanity', 'contentful', 'wordpress', 'shopify', 'webflow',
];

export const NORMALIZED_SKILLS: string[] = Array.from(new Set(SKILL_LEXICON.map((s) => s.trim().toLowerCase()))).sort();

const ALIASES: Record<string, string> = {
  reactjs: 'react',
  'react.js': 'react',
  nextjs: 'next.js',
  'next.js': 'next.js',
  vuejs: 'vue',
  'vue.js': 'vue',
  nodejs: 'node.js',
  'node.js': 'node.js',
  postgres: 'postgresql',
  postgresgres: 'postgresql',
  js: 'javascript',
  ts: 'typescript',
  'tailwind css': 'tailwind',
  tailwindcss: 'tailwind',
  'material ui': 'mui',
  'machine learning': 'ml',
  cicd: 'ci/cd',
  'ci-cd': 'ci/cd',
  'react native': 'react native',
  golang: 'go',
  'csharp': 'c#',
  dotnet: '.net',
  '.net': '.net',
  aspnet: 'asp.net',
  'express.js': 'express',
};

export function canonicalSkill(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  return ALIASES[key] ?? key;
}

export function normalizeSkillList(raw: string[]): string[] {
  const set = new Set<string>();
  for (const item of raw) {
    const value = canonicalSkill(item);
    if (value.length >= 2) set.add(value);
  }
  return Array.from(set).sort();
}

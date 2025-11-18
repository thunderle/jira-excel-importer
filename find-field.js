require('dotenv').config();

const https = require('https');

async function findStoryPointsField() {
    const host = process.env.JIRA_HOST.replace('https://', '').replace('http://', '');
    const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');

    const options = {
        hostname: host,
        path: '/rest/api/3/field',  // ← API v3
        method: 'GET',
        headers: {
            'Authorization': `Basic ${auth}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    };

    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', chunk => data += chunk);

            res.on('end', () => {
                try {
                    const fields = JSON.parse(data);

                    console.log('🔍 Tìm Story Points field...\n');
                    console.log('📋 Các custom fields có "point" hoặc "estimate":\n');

                    fields
                        .filter(f =>
                            f.name.toLowerCase().includes('point') ||
                            f.name.toLowerCase().includes('estimate')
                        )
                        .forEach(f => {
                            console.log(`  ${f.name}`);
                            console.log(`  └─ ID: ${f.id}`);
                            console.log(`  └─ Type: ${f.schema?.type || 'unknown'}\n`);
                        });

                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on('error', reject);
        req.end();
    });
}

findStoryPointsField().catch(console.error);

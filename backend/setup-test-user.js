#!/usr/bin/env node
/**
 * Setup script to create/update test user in Supabase
 * Run: node backend/setup-test-user.js
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const supabase = require('./config/supabase');

const TEST_USERNAME = process.env.TEST_USERNAME || 'test';
const TEST_PASSWORD = process.env.TEST_PASSWORD || 'Welcome@1234';

async function setupTestUser() {
  try {
    console.log(`[Setup] Creating/updating test user: ${TEST_USERNAME}`);

    // Hash the password
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    console.log('[Setup] Password hashed');

    // Try to find existing user
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .ilike('username', TEST_USERNAME)
      .single();

    if (existingUser) {
      // Update existing user
      const { error } = await supabase
        .from('users')
        .update({
          password_hash: passwordHash,
          is_active: true,
          expires_at: null,
          locked_until: null,
        })
        .eq('id', existingUser.id);

      if (error) throw error;
      console.log(`✓ Updated existing user: ${TEST_USERNAME}`);
    } else {
      // Create new user
      const { error } = await supabase
        .from('users')
        .insert([
          {
            username: TEST_USERNAME,
            email: `${TEST_USERNAME}@test.local`,
            password_hash: passwordHash,
            role: 'admin',
            is_active: true,
            total_tokens: 1000000,
            used_tokens: 0,
            per_query_limit: 100000,
            session_minutes: 60,
          },
        ]);

      if (error) throw error;
      console.log(`✓ Created new test user: ${TEST_USERNAME}`);
    }

    console.log('[Setup] Test user ready!');
    console.log(`   Username: ${TEST_USERNAME}`);
    console.log(`   Password: ${TEST_PASSWORD}`);
    console.log('\nYou can now run real E2E tests:');
    console.log('   npx playwright test --config=playwright.real.config.ts');
    process.exit(0);
  } catch (err) {
    console.error('[Setup] ERROR:', err.message);
    process.exit(1);
  }
}

setupTestUser();

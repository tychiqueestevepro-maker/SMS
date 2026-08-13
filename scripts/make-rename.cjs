const fs = require('fs');
const files = [
  'src/app/(app)/contacts/actions.ts',
  'src/lib/contacts/csv-import.ts',
  'src/lib/contacts/phone.test.ts',
  'src/lib/inbox/conversations.ts',
  'src/lib/inbox/inbound.ts',
  'src/lib/numbers/business.ts'
];
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/normalizeUsPhoneNumber/g, 'normalizePhoneNumber');
  fs.writeFileSync(file, content);
}

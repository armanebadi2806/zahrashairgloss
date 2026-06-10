import { hashPassword } from '../server/auth.mjs';

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error('Bitte ein Passwort mit mindestens 12 Zeichen angeben.');
  process.exit(1);
}
console.log(hashPassword(password));

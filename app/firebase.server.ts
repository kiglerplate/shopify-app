// firebase.js
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const serviceAccount = {
  private_key: `-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQC5B7z+iDN7+m/f\n5lsAODM+PvTiqFoZQieLz+NgBJK5gUUhWxk7KhOLaFQ6Vq+zq9xS3IcQ1VBOWYJq\np0f3hTF1EIj+Dsoq3shw4sOdPxNGTpam93d4JzQvSAMGPx9ahrR5z0F3Fw2XOyIi\nn2PQWod1yhcI+1JZav40DxVjiZK+BXgyDndF7RuULzUEjfhmi3wWcEYEB9jt1QvA\n1atEQNGSROwgL/Jfx1kjhVt8aVaIbccQhMuNmgs8JHHn8aEKvfX4BdGDLAMelR9e\nT2KxlEcGoUmycaqa+3RbY6i+c8GT6iVp5vnLyoFBqdTB4r51bx/rNgF4ZdtjlsIC\nGTvE5QffAgMBAAECggEAG/9IQSlhxO4xlGr6NQ/L7SzAiDVaIL1KV5T2vjYi72/Y\ngoIS0Ml+mJcKO6OXRXQJS/5zb4AffSN9IN87+/+K6sA8QlkBjTgVk0M0vyvmojpN\nAGmsiaFA+7CFSKIvf9anI1FRghAabdo0QZHlnAa+vXt9Pc4teTs/yKfJoDyWWCsg\nt1VJPiB2cAspPkX/0ZUW4SUNCTsx2MUhdKNtcO4SRRyK12Osi4LjZwLw/fqTIWr7\nROZf4F6WNWZufyxAXwwumitcQFFHzmF2Y9Yvz/k3/w1/gERlXFPzfEhX+xZN6Bif\nJBIU1hri4dvbeAXq+sokM4ONhUZ9c78n7cpiFLgMiQKBgQDnLqMjlDdhO2tOSHb6\n7zMOYA4cp3OvuUYJuEJGMvNImEdIyYK6z8YLhJLIdY8DJhBQt1ECtjq+l3wg4y3F\n6XKyj+bi12wsBo9zqArR1ahbE+Njpn+PF0j3HS812owxevDAyN/XE5O8gOoDhpg0\n7GrZW2AVkT1w64EpvxTKuNpidwKBgQDM5MAT1CfK1G6gBxCZLvyd05vDqrdsSbcO\nEcuAu45g60FDW6vqQMdjYtByMQIG+GpGX4/mdVawGRUArYpw53qKZ0HJDZOdbj07\nVEHQCdwLvvgFXfOWrLkXBS7GhYP3c+VXV4nDxy5kSWkiE3yKuvQqvdhmHkYZEQae\nAdMzpGA32QKBgQCpgA1HAd4U4U8M556s34KssIrIQZJVrd8HM10MQUEU4emqGW1L\ncRmAymQgq+j+YwMlWzL/bQLnSQROzKJ78G0TNOURPudl5C17nCLKtP+qP4vCPYpb\nLLRn0rMRpjqR8NTiVKWh+Q2h8Vci3KVucETrNs7dIU9OIq3iIOKqvBwKgwKBgQDC\ndfi22QxLPQMhbpMaT7YCNOwI8OXVKMFL4Se7rkabRaxTOZYYZhLXCNm9BzZdVzfG\nQrxYhdUYnTWJxys1rPxoj0eogfIv4IjM3lL4F+N4Ym8S6PBfeN7SMmEKmX1+RcjM\n9JAT997X37SgWs5A/N7wEe5oPSNadwZIwIKq6L9JQQKBgQDP2Q4558MPdxPeuBHG\nWcAEZhVT5hkvriPY5kItQhx06RFVbVFo/tR/5+pVMSYbic+ZwA7wnmd4c00xoqWP\nlCgvwLSNk5Y+8DA4+VbOx6JoVO4tXTaD9AaB17nObh6UgyEoHiNvZ7JUMDaBtEYq\n4SAhvsVPGllnSTBLFA26yEIUGA==\n-----END PRIVATE KEY-----\n`,
  client_email: `firebase-adminsdk-fbsvc@wixapp-8efb6.iam.gserviceaccount.com`,
  project_id: "wixapp-8efb6",
};

if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}

export const db = getFirestore();
export const admin = getAuth();

import * as oidc from 'openid-client';
import {randomBytes} from 'node:crypto';
import {identityFromClaims} from './domain.js';
const sessionSave=req=>new Promise((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
const regenerate=req=>new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
export async function createAuth({tenant,clientId,clientSecret,origin,basePath='',requiredRole='',sessionMs=12*60*60*1000}){
 const config=await oidc.discovery(new URL('https://login.microsoftonline.com/'+tenant+'/v2.0'),clientId,clientSecret);
 oidc.enableNonRepudiationChecks(config);
 return authHandlers(config,{tenant,origin,basePath,requiredRole,sessionMs});
}
export function authHandlers(config,{tenant,origin,basePath='',requiredRole='',sessionMs=12*60*60*1000}){
 return {
 login:async(req,res)=>{
  const verifier=oidc.randomPKCECodeVerifier(),state=oidc.randomState(),nonce=oidc.randomNonce();
  req.session.flow={verifier,state,nonce,created:Date.now()};
  const url=oidc.buildAuthorizationUrl(config,{redirect_uri:origin+basePath+'/auth/callback',scope:'openid profile email',response_mode:'query',code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',state,nonce,prompt:'select_account'});
  await sessionSave(req);res.redirect(url.href);
 },
 callback:async(req,res)=>{
  const flow=req.session.flow;delete req.session.flow;await sessionSave(req);
  if(!flow||Date.now()-flow.created>10*60*1000)return res.redirect(basePath+'/?authError=expired');
  try{
   const tokens=await oidc.authorizationCodeGrant(config,new URL(req.originalUrl,origin),{pkceCodeVerifier:flow.verifier,expectedState:flow.state,expectedNonce:flow.nonce,idTokenExpected:true});
   const claims=tokens.claims(),user=identityFromClaims(claims,tenant,requiredRole);
   await regenerate(req);
   req.session.user=user;req.session.csrf=randomBytes(32).toString('hex');
   req.session.expiresAt=Date.now()+sessionMs; // reuniões longas: a sessão não pode cair no meio da gravação
   await sessionSave(req);res.redirect(basePath+'/');
  }catch(error){console.error('login_failed',error.code||error.name);res.redirect(basePath+'/?authError=denied');}
 }
};
}


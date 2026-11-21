import F from"node:fs"
let E=process.env,I=E.MAKEFUN_INPUT_DIR,O=E.MAKEFUN_OUTPUT_DIR,S,D,L,G,J,K,i
function fd(p,B,e){let m=new Map([[p,0]]);for(let x of m.keys()){for(i=4;i--;){let y=x+D[i];if(L[y]!=35&!B.includes(y)&!m.has(y)&(y/S|0)!=e)m.set(y,i)}}return m}
function rm(B0,c,st){let q=[[B0,st,[]]],n=new Set([B0+","+st]),N,k,t;for(let[B,p,pa]of q){if(B.every(x=>G.has(x)))return pa;let v=fd(p,B);for(let b of B)for(i=4;i--;)t=b+D[i],c.has(t)&!B.includes(t)&v.has(b-D[i])&&(N=B.map(x=>x==b?t:x),N.sort(),k=N+","+b,n.has(k)||(n.add(k),q.push([N,b,[...pa,[b,i]]])))}return null}
function Z(){S=L.indexOf(10)+1,D=[-S,S,-1,1];let B=[],P=0;G=new Set();for(let[p,c]of L.entries())c%6==0&&B.push(p),c>41&c<47&&G.add(p),c%21==1&&(P=p);let y=(P/S)|0,m="",W=B;for(let x=S-1;--x;)for(J of[-1,1]){K=(y+J)*S+x;if(L[K]!=35){let f=fd(K,[],y),s=rm(W.filter(b=>f.has(b)),f,P);if(!s)return"";for(let[b,i]of s){let g=fd(P,W),C=t=>t==P?"":C(t-D[g.get(t)])+"udlr"[g.get(t)];m+=C(b-D[i])+"udlr"[i];W[W.indexOf(b)]=b+D[i];P=b}}}return m}
for(let k=0;++k<6;)J=I+"/i00"+k,K=O+"/i00"+k,L=F.readFileSync(J+"/level.txt"),F.mkdirSync(K,{recursive:1}),F.writeFileSync(K+"/solution.txt",Z())

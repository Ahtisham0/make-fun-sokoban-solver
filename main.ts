import F from"node:fs"
let e=process.env,I=e.MAKEFUN_INPUT_DIR,O=e.MAKEFUN_OUTPUT_DIR,S,D,L,G,i,J,K,k
function f(p,B,r){let a=[],q=[p];a[p]=" ";for(let x of q)for(i=4;i--;){let y=x+D[i];L[y]-35&&!B.includes(y)&&!a[y]&&(y/S|0)!=r&&(a[y]=a[x]+"udlr"[i],q.push(y))}return a}
function R(A,c,s,O){let q=[[A,s,""]],v=new Set([A+s]),N,t;for(let[B,p,a]of q){if(B.every(b=>G.has(b)))return[a,B,p];let d=f(p,B.concat(O));for(let b of B)for(i=4;i--;)t=b+D[i],c[t]&&!B.includes(t)&&d[b-D[i]]&&(N=B.map(x=>x-b?x:t),N.sort(),!v.has(N+","+b)&&(v.add(N+","+b),q.push([N,b,a+d[b-D[i]]+"udlr"[i]])))}return 0}
function Z(){S=L.indexOf(10)+1,D=[-S,S,-1,1];let W=[],P=0,y,m="";G=new Set;for(let[p,c]of L.entries())c%6==0&&W.push(p),c>41&c<47&&G.add(p),c%21==1&&(P=p);y=P/S|0;for(let x=S-1;--x;)for(J of[-1,1]){K=(y+J)*S+x;if(L[K]-35){let d=f(K,[],y),o=W.filter(b=>!d[b]),s=R(W.filter(b=>d[b]),d,P,o);if(!s)return"";m+=s[0];W=s[1].concat(o);P=s[2]}}return m}
for(k=0;++k<6;)J=I+"/i00"+k,K=O+"/i00"+k,L=F.readFileSync(J+"/level.txt"),F.mkdirSync(K),F.writeFileSync(K+"/solution.txt",Z())

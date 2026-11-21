import F from"node:fs"
let e=process.env,I=e.MAKEFUN_INPUT_DIR,O=e.MAKEFUN_OUTPUT_DIR,S,D,L,i,J,K,y,k
let f=(p,B,r,a=[],s=" ")=>{a[p]=s;for(let i=4;i--;){y=p+D[i];L[y]-35&&!B.includes(y)&&!a[y]&&(y/S|0)!=r&&f(y,B,r,a,s+"udlr"[i])}return a}
function R(A,c,s,O){let q=[[A,s,""]],v={},N,t,w,n;v[A+","+s]=1;for(let[B,p,a]of q){if(B.every(b=>L[b]>41&L[b]<47))return[a,B,p];let d=f(p,B.concat(O));for(let b of B)for(i=4;i--;)t=b+D[i],w=d[b-D[i]],c[t]&&!B.includes(t)&&w&&(N=B.map(x=>x-b?x:t),N.sort(),n=N+","+b,!v[n]&&(v[n]=1,q.push([N,b,a+w+"udlr"[i]])))}return 0}
function Z(){S=L.indexOf(10)+1;D=[-S,S,-1,1];let W=[],P=0,y,m="";for(let[p,c]of L.entries())c%6==0&&W.push(p),c==64&&(P=p);y=P/S|0;for(let x=S-1;--x;)for(J of[-1,1]){K=(y+J)*S+x;if(L[K]-35){let d=f(K,[],y),o=W.filter(b=>!d[b]),s=R(W.filter(b=>d[b]),d,P,o);if(!s)return"";m+=s[0];W=[...s[1],...o];P=s[2]}}return m}
for(k=0;++k<6;){J=I+"/i00"+k,K=O+"/i00"+k;L=F.readFileSync(J+"/level.txt");F.mkdirSync(K);F.writeFileSync(K+"/solution.txt",Z())}

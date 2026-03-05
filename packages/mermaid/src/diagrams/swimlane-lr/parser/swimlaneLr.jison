/** mermaid
 * Swimlane-LR diagram parser
 */
%lex

%options case-insensitive

%x NODE_LABEL
%x CLASSDEF_ID
%x CLASSDEF_STYLES
%x LANE_ID
%x LANE_QUOTED
%x LANE_COLOR

%%

\s*\%\%[^\n]*                          /* skip comments */
"swimlane-lr"                          return 'SWIMLANE_LR';
[\n]+                                  return 'NL';
"classDef"                             { this.begin('CLASSDEF_ID'); return 'CLASSDEF'; }
<CLASSDEF_ID>\s+                       /* skip whitespace */
<CLASSDEF_ID>[a-zA-Z_][a-zA-Z0-9_]*   { this.popState(); this.begin('CLASSDEF_STYLES'); return 'CLASSDEF_NAME'; }
<CLASSDEF_STYLES>\s+                   /* skip leading whitespace */
<CLASSDEF_STYLES>[^\n]+                { this.popState(); return 'STYLE_STR'; }
"lane"                                 { this.begin('LANE_ID'); return 'LANE'; }
<LANE_ID>\s+                           /* skip whitespace */
<LANE_ID>["]                           { this.popState(); this.begin('LANE_QUOTED'); }
<LANE_QUOTED>[^"]+                     { return 'LANE_LABEL'; }
<LANE_QUOTED>["]                       { this.popState(); this.begin('LANE_COLOR'); }
<LANE_ID>[a-zA-Z_][a-zA-Z0-9_]*       { this.popState(); this.begin('LANE_COLOR'); return 'LANE_LABEL'; }
<LANE_COLOR>\s+                        /* skip whitespace */
<LANE_COLOR>#[0-9a-fA-F]{3,6}         { this.popState(); return 'LANE_HEX'; }
<LANE_COLOR>[\n]                       { this.popState(); return 'NL'; }
<LANE_COLOR><<EOF>>                    { this.popState(); return 'EOF'; }
":::"                                 return 'CLASSAPPLY';
"-.->"                                 return 'DASHED_ARROW';
"-->"                                  return 'SOLID_ARROW';
"--"                                   return 'DOUBLE_DASH';
"-.-"                                  return 'DASHED_LINE';
"->"                                   return 'ARROW_TIP';
\[#[0-9a-fA-F]{3,6}\]                 { yytext = yytext.slice(1, -1); return 'EDGE_COLOR'; }
["]([^"]*)["]                          { yytext = yytext.slice(1, -1); return 'QUOTED_STR'; }
"(["                                   { this.begin('NODE_LABEL'); return 'STADIUM_OPEN'; }
"(("                                   { this.begin('NODE_LABEL'); return 'CIRCLE_OPEN'; }
"{"                                    { this.begin('NODE_LABEL'); return 'DIAMOND_OPEN'; }
"["                                    { this.begin('NODE_LABEL'); return 'RECT_OPEN'; }
<NODE_LABEL>"])"                       { this.popState(); return 'STADIUM_CLOSE'; }
<NODE_LABEL>"))"                       { this.popState(); return 'CIRCLE_CLOSE'; }
<NODE_LABEL>"}"                        { this.popState(); return 'DIAMOND_CLOSE'; }
<NODE_LABEL>"]"                        { this.popState(); return 'RECT_CLOSE'; }
<NODE_LABEL>[^\]\)\}]+                 return 'LABEL_TEXT';
\s+                                    /* skip whitespace */
[a-zA-Z_][a-zA-Z0-9_]*                return 'ID';
<<EOF>>                                return 'EOF';

/lex

%start start

%% /* language grammar */

start
  : SWIMLANE_LR sep document EOF { return yy; }
  ;

sep
  : NL
  |
  ;

document
  : document sep statement
  | statement
  ;

statement
  : laneDecl
  | classDefStmt
  | edgeStatement
  | rectNode
  | diamondNode
  | circleNode
  | stadiumNode
  ;

laneDecl
  : LANE LANE_LABEL LANE_HEX     { yy.addLane($2, $3); }
  | LANE LANE_LABEL               { yy.addLane($2); }
  ;

classDefStmt
  : CLASSDEF CLASSDEF_NAME STYLE_STR  { yy.addClass($2, $3); }
  ;

rectNode
  : ID RECT_OPEN LABEL_TEXT RECT_CLOSE CLASSAPPLY ID
    { yy.addNode($1, $3, 'rectangle', $6); }
  | ID RECT_OPEN LABEL_TEXT RECT_CLOSE
    { yy.addNode($1, $3, 'rectangle'); }
  ;

diamondNode
  : ID DIAMOND_OPEN LABEL_TEXT DIAMOND_CLOSE CLASSAPPLY ID
    { yy.addNode($1, $3, 'diamond', $6); }
  | ID DIAMOND_OPEN LABEL_TEXT DIAMOND_CLOSE
    { yy.addNode($1, $3, 'diamond'); }
  ;

circleNode
  : ID CIRCLE_OPEN LABEL_TEXT CIRCLE_CLOSE CLASSAPPLY ID
    { yy.addNode($1, $3, 'circle', $6); }
  | ID CIRCLE_OPEN LABEL_TEXT CIRCLE_CLOSE
    { yy.addNode($1, $3, 'circle'); }
  ;

stadiumNode
  : ID STADIUM_OPEN LABEL_TEXT STADIUM_CLOSE CLASSAPPLY ID
    { yy.addNode($1, $3, 'stadium', $6); }
  | ID STADIUM_OPEN LABEL_TEXT STADIUM_CLOSE
    { yy.addNode($1, $3, 'stadium'); }
  ;

edgeStatement
  : edgeStatement edgeOp ID
    { yy.addEdge($1, $3, $2.style, $2.label, $2.color); $$ = $3; }
  | ID edgeOp ID
    { yy.addEdge($1, $3, $2.style, $2.label, $2.color); $$ = $3; }
  ;

edgeOp
  : SOLID_ARROW
    { $$ = { style: 'solid' }; }
  | DOUBLE_DASH EDGE_COLOR QUOTED_STR SOLID_ARROW
    { $$ = { style: 'solid', color: $2, label: $3 }; }
  | DOUBLE_DASH EDGE_COLOR SOLID_ARROW
    { $$ = { style: 'solid', color: $2 }; }
  | DOUBLE_DASH QUOTED_STR SOLID_ARROW
    { $$ = { style: 'solid', label: $2 }; }
  | DASHED_ARROW
    { $$ = { style: 'dashed' }; }
  | DASHED_LINE EDGE_COLOR QUOTED_STR ARROW_TIP
    { $$ = { style: 'dashed', color: $2, label: $3 }; }
  | DASHED_LINE EDGE_COLOR ARROW_TIP
    { $$ = { style: 'dashed', color: $2 }; }
  | DASHED_LINE QUOTED_STR ARROW_TIP
    { $$ = { style: 'dashed', label: $2 }; }
  ;

%%
